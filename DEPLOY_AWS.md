# Deploying GitPulse to AWS App Runner

Fast path: two container images in ECR, two App Runner services. App Runner is
the AWS service closest to Cloud Run — image in, HTTPS URL out, no load balancer,
no VPC, no task definitions.

**Region: `ap-southeast-1` (Singapore).** Neon is hosted on AWS in that same
region, so the app and database sit in one region.

| Service | Image | Dockerfile |
|---|---|---|
| `gitpulse-web` | `gitpulse-web` | [`Dockerfile`](Dockerfile) |
| `gitpulse-rag` | `gitpulse-rag` | [`rag_service/Dockerfile`](rag_service/Dockerfile) |

Both containers listen on **port 8080**.

---

## 0. Install the AWS CLI

```bash
curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
  && unzip -q -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install --update
```

```bash
aws configure
```

Enter your access key, secret, `ap-southeast-1`, and `json`. Then confirm and
capture your account ID:

```bash
aws sts get-caller-identity --query Account --output text
```

## 1. Create the ECR repositories

```bash
export AWS_REGION=ap-southeast-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

aws ecr create-repository --repository-name gitpulse-web --region $AWS_REGION
aws ecr create-repository --repository-name gitpulse-rag --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR
```

## 2. Build and push — start the web image first

The web image is ~660MB and the push is the slowest step, so kick it off before
anything else and do the rest while it uploads.

```bash
docker build -t $ECR/gitpulse-web:v1 . && docker push $ECR/gitpulse-web:v1
```

Then the RAG image (~280MB):

```bash
docker build -f rag_service/Dockerfile -t $ECR/gitpulse-rag:v1 . \
  && docker push $ECR/gitpulse-rag:v1
```

## 3. Create the RAG service

Console -> **App Runner** -> *Create service*. The console can generate the ECR
access role for you, which is why it beats the CLI here.

- **Source:** Container registry -> Amazon ECR -> `gitpulse-rag:v1`
- **Deployment trigger:** Manual
- **ECR access role:** *Create new service role*
- **Port:** `8080`
- **CPU/Memory:** 0.25 vCPU / 0.5 GB is enough
- **Environment variables:**

```
GEMINI_API_KEY           <from .env>
GITHUB_TOKEN             <from .env>
RAG_MAX_CONTEXT_TOKENS   200000
```

Copy the service URL it produces, then verify:

```bash
curl https://XXXX.ap-southeast-1.awsapprunner.com/healthz
```

> Publicly reachable. Anyone with the URL can spend your Gemini quota. Fine for
> today; restrict it before you publicise the app.

## 4. Create the web service

Same flow, image `gitpulse-web:v1`, port `8080`, 1 vCPU / 2 GB.

Environment variables:

```
DATABASE_URL           <pooled Neon URL>
DIRECT_URL             <direct Neon URL>
AUTH_SECRET            <from .env>
AUTH_GITHUB_ID         <from .env>
AUTH_GITHUB_SECRET     <from .env>
GITHUB_TOKEN           <from .env>
GEMINI_API_KEY         <from .env>
RAG_PIPELINE_URL       <RAG service URL from step 3>
RAG_MAX_CONTEXT_TOKENS 200000
```

`NEXT_PUBLIC_*` values are **build args, not runtime env** — they are compiled
into the client bundle, so setting them here does nothing. See *Known gaps*.

## 5. Update the GitHub OAuth callback

**Do not skip.** Sign-in gates chat, dashboard and scans.

GitHub -> Settings -> Developer settings -> OAuth Apps -> your app -> add:

```
https://YOUR-APPRUNNER-URL/api/auth/callback/github
```

Keep the localhost entry for local development.

## 6. Migrations

Already applied to Neon from your machine. For future schema changes, run
against `DIRECT_URL` — advisory locks do not survive the pooler:

```bash
npx prisma migrate deploy
```

---

## Known gaps after a rushed deploy

- **`NEXT_PUBLIC_APP_URL` is wrong.** Affects canonical URLs, sitemap, robots,
  OG metadata, and scan share links. All cosmetic or SEO — the CORS check in
  [`src/proxy.ts`](src/proxy.ts) only sets headers, it never blocks, so nothing
  functional breaks. Fix by rebuilding with
  `--build-arg NEXT_PUBLIC_APP_URL=https://your-url`.
- **Secrets are plain env vars.** Visible to anyone with console access. Move to
  Secrets Manager and reference the ARNs once the deadline passes.
- **No custom domain.** Required before AdSense — `*.awsapprunner.com` is not a
  domain you own.
- **No Redis.** `KV_REST_API_*` unset means caching and the deep-scan quota
  degrade to no-ops. The app runs correctly, just does more work per request.

## Cost

App Runner does **not** scale to zero — it bills for provisioned memory while
idle, roughly $5–7/month per service. Two services is ~$10–15/month. Pause or
delete them when not demoing.

## Redeploying

```bash
docker build -t $ECR/gitpulse-web:v2 . && docker push $ECR/gitpulse-web:v2
```

Then App Runner -> service -> *Deploy* and select the new tag. Bump the tag every
time; reusing `:v1` makes rollback impossible.
