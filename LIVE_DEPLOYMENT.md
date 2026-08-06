# GitPulse — Live Deployment

Deployed 1 August 2026.

## Live URLs

**Web app (this is the one to share):**

https://gitpulse-web.yellowstone-745f9fa6.centralindia.azurecontainerapps.io

**RAG service** (internal API, backs repo chat):

https://gitpulse-rag.yellowstone-745f9fa6.centralindia.azurecontainerapps.io

Health check: `/healthz` → `{"status":"ok"}`

## Stack

| Layer | What |
|---|---|
| Compute | Azure Container Apps, Central India (`centralindia`) |
| Registry | Azure Container Registry `gitpulseacr04721` |
| Database | Neon Postgres 18.4, Singapore (`ap-southeast-1`) |
| Auth | GitHub OAuth via NextAuth v5 |
| Web image | Next.js 16.1.1, standalone output, 662 MB |
| RAG image | FastAPI + uvicorn, Python 3.13, 282 MB |

Both containers listen on port 8080. Secrets are stored as Azure Container Apps
secrets and injected via `secretref:`, not as plaintext environment variables.

Resource group: `gitpulse-rg2`
Environment: `gitpulse-env`
Subscription: Azure for Students

## GitHub OAuth

Authorization callback URL registered on the OAuth app:

```
https://gitpulse-web.yellowstone-745f9fa6.centralindia.azurecontainerapps.io/api/auth/callback/github
```

GitHub OAuth Apps allow only one callback URL, so local development sign-in
needs this swapped back to `http://localhost:3000/...`, or a second OAuth app.

## Managing it

```bash
# Logs
az containerapp logs show -n gitpulse-web -g gitpulse-rg2 --tail 50 --type console

# Current environment variables
az containerapp show -n gitpulse-web -g gitpulse-rg2 \
  --query "properties.template.containers[0].env[].name" -o tsv

# Change an environment variable (no rebuild needed)
az containerapp update -n gitpulse-web -g gitpulse-rg2 --set-env-vars "KEY=value"

# Redeploy after a code change
docker build -t gitpulseacr04721.azurecr.io/gitpulse-web:v2 .
docker push gitpulseacr04721.azurecr.io/gitpulse-web:v2
az containerapp update -n gitpulse-web -g gitpulse-rg2 \
  --image gitpulseacr04721.azurecr.io/gitpulse-web:v2

# Tear everything down
az group delete -n gitpulse-rg2 --yes
```

Bump the image tag on every redeploy. Reusing a tag makes rollback impossible.

## Things worth remembering

**`AUTH_TRUST_HOST=true` is required.** NextAuth v5 rejects requests behind a
reverse proxy without it, failing with `UntrustedHost`. Vercel sets this
implicitly; Azure Container Apps, Cloud Run and App Runner do not. This was the
last bug before sign-in worked.

**Azure for Students restricts regions.** `southeastasia` is disallowed
(`RequestDisallowedByAzure`); `centralindia` works.

**Azure for Students blocks ACR Tasks** (`TasksOperationsNotAllowed`), so
`az acr build` fails. Images must be built locally and pushed to the registry.

**Providers need registering** on a fresh subscription: `Microsoft.App`,
`Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights`.

**Neon free tier scales to zero.** The first request after idle takes a few
hundred extra milliseconds.

## Known gaps

- `NEXT_PUBLIC_APP_URL` is unset, so canonical URLs, sitemap, robots and OG
  metadata point at localhost. Cosmetic and SEO only — nothing functional
  depends on it. Fix by rebuilding with
  `--build-arg NEXT_PUBLIC_APP_URL=https://<web-url>`.
- No custom domain. Required before AdSense: `*.azurecontainerapps.io` is not a
  domain you own.
- No Redis (`KV_REST_API_*` unset), so caching and the deep-scan quota degrade
  to no-ops. The app runs correctly, just does more work per request.
- The RAG service is publicly reachable. Anyone with the URL can spend the
  Gemini quota.

## Cost

Roughly ₹400–700/month against the ₹4,683 Azure for Students credit, which
expires 29 November 2026. Delete the resource group when the demo is over.
