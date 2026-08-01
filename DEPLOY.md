# Deploying GitPulse to Google Cloud Run

Two services, both containerised:

| Service | Image | Purpose |
|---|---|---|
| `gitpulse-web` | [`Dockerfile`](Dockerfile) | Next.js app |
| `gitpulse-rag` | [`rag_service/Dockerfile`](rag_service/Dockerfile) | FastAPI RAG pipeline |

The database is Neon (Singapore). Cloud Run runs in `asia-southeast1`, the same
city, so queries stay at ~1-2ms instead of crossing an ocean.

Replace `YOUR_PROJECT_ID` throughout.

---

## 0. Install and authenticate gcloud

Arch:

```bash
yay -S google-cloud-cli
```

Or distro-agnostic: https://cloud.google.com/sdk/docs/install

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region asia-southeast1
```

## 1. Enable the APIs

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

## 2. Create the image registry

```bash
gcloud artifacts repositories create gitpulse \
  --repository-format=docker \
  --location=asia-southeast1

gcloud auth configure-docker asia-southeast1-docker.pkg.dev
```

## 3. Store the secrets

Never pass these as plain `--set-env-vars`; anyone with console read access can
see those. Secret Manager keeps them out of the service definition.

```bash
for KEY in DATABASE_URL DIRECT_URL AUTH_SECRET AUTH_GITHUB_ID AUTH_GITHUB_SECRET GITHUB_TOKEN GEMINI_API_KEY; do
  VALUE=$(grep "^${KEY}=" .env | cut -d'"' -f2)
  printf '%s' "$VALUE" | gcloud secrets create "$KEY" --data-file=- 2>/dev/null \
    || printf '%s' "$VALUE" | gcloud secrets versions add "$KEY" --data-file=-
done
```

Grant the runtime service account read access:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
for KEY in DATABASE_URL DIRECT_URL AUTH_SECRET AUTH_GITHUB_ID AUTH_GITHUB_SECRET GITHUB_TOKEN GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding "$KEY" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

## 4. Deploy the RAG service first

The web service needs its URL, so this one goes first.

```bash
REGISTRY=asia-southeast1-docker.pkg.dev/YOUR_PROJECT_ID/gitpulse

docker build -f rag_service/Dockerfile -t $REGISTRY/rag:v1 .
docker push $REGISTRY/rag:v1

gcloud run deploy gitpulse-rag \
  --image $REGISTRY/rag:v1 \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --set-env-vars RAG_MAX_CONTEXT_TOKENS=200000 \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,GITHUB_TOKEN=GITHUB_TOKEN:latest
```

Note the URL it prints, then confirm it is alive:

```bash
curl https://gitpulse-rag-XXXX.asia-southeast1.run.app/healthz
```

> **This service is publicly reachable.** Anyone who finds the URL can spend your
> Gemini quota. Acceptable for a first deploy; see *Hardening* below before you
> publicise the app.

## 5. Deploy the web service

`NEXT_PUBLIC_*` values are compiled into the client bundle, so they are **build
args, not runtime env vars**. Setting them in Cloud Run does nothing.

That creates a chicken-and-egg problem for `NEXT_PUBLIC_APP_URL`: you do not know
the service URL until after the first deploy. Either map your custom domain first
and use that, or deploy once with a placeholder and rebuild with the real value.

```bash
RAG_URL=$(gcloud run services describe gitpulse-rag --region asia-southeast1 --format='value(status.url)')

docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://your-domain.com \
  --build-arg NEXT_PUBLIC_ADSENSE_CLIENT_ID= \
  --build-arg NEXT_PUBLIC_ADSENSE_SLOT_HOMEPAGE= \
  -t $REGISTRY/web:v1 .
docker push $REGISTRY/web:v1

gcloud run deploy gitpulse-web \
  --image $REGISTRY/web:v1 \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --set-env-vars "RAG_PIPELINE_URL=${RAG_URL},RAG_MAX_CONTEXT_TOKENS=200000" \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,AUTH_SECRET=AUTH_SECRET:latest,AUTH_GITHUB_ID=AUTH_GITHUB_ID:latest,AUTH_GITHUB_SECRET=AUTH_GITHUB_SECRET:latest,GITHUB_TOKEN=GITHUB_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest
```

## 6. Database migrations

Migrations are **not** run on container start, so concurrent instances cannot
race each other. Run them yourself against `DIRECT_URL` (never the pooled URL —
advisory locks do not survive a pooler):

```bash
npx prisma migrate deploy
```

Your local `.env` already points at Neon, so this works from your machine. Do it
before deploying a release that depends on a new migration.

## 7. Custom domain

```bash
gcloud beta run domain-mappings create --service gitpulse-web --domain your-domain.com --region asia-southeast1
```

Add the DNS records it prints. Required for AdSense — `*.run.app` is owned by
Google, not you, so AdSense will reject it.

## 8. Update the GitHub OAuth callback

In **GitHub → Settings → Developer settings → OAuth Apps**, add:

```
https://your-domain.com/api/auth/callback/github
```

Sign-in breaks in production without this. Keep the localhost entry for local dev.

---

## Redeploying

```bash
docker build -t $REGISTRY/web:v2 . && docker push $REGISTRY/web:v2
gcloud run deploy gitpulse-web --image $REGISTRY/web:v2 --region asia-southeast1
```

Bump the tag each time. Reusing `:v1` makes rollbacks impossible.

## Hardening (before going public)

- **Lock down the RAG service.** Remove `--allow-unauthenticated`, give the web
  service its own service account with `roles/run.invoker` on the RAG service,
  and have the web service attach an ID token. Requires an app change: the RAG
  call currently sends no auth header.
- **Set `--max-instances`** on both services so a traffic spike or a loop cannot
  produce a surprise bill.
- **Add Upstash Redis** for `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Without it,
  caching and the deep-scan quota degrade to no-ops (gracefully — the app runs
  fine, it just does more work per request).

## Notes

- Build on `linux/amd64`. Cloud Run does not run arm64 images; add
  `--platform linux/amd64` if you ever build from an ARM machine.
- The image build needs no database. `prisma generate` needs no connection, and
  the blog and sitemap routes degrade to empty when Postgres is unreachable, then
  refresh via ISR within an hour of startup.
- Neon's free tier scales to zero. The first request after idle takes a few
  hundred extra milliseconds while the compute wakes.
