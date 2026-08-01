#!/usr/bin/env bash
# One-shot Cloud Run deploy. Run after `gcloud auth login`.
#
# Builds both images with Cloud Build (uploads source, not the 662MB image),
# deploys the RAG service, then the web service wired to it.
set -euo pipefail

PROJECT_ID=${PROJECT_ID:-theta-bindery-479710-v0}
REGION=${REGION:-asia-southeast1}
REPO=gitpulse
IMG_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"

echo "==> Project ${PROJECT_ID}, region ${REGION}"
gcloud config set project "$PROJECT_ID" --quiet
gcloud config set run/region "$REGION" --quiet

echo "==> Enabling APIs (slow the first time)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --quiet

echo "==> Artifact Registry"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" --quiet 2>/dev/null \
  && echo "    created" || echo "    already exists"

# ---------- RAG service ----------
echo "==> Building RAG image via Cloud Build"
cat > /tmp/cloudbuild.rag.yaml <<YAML
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', 'rag_service/Dockerfile', '-t', '${IMG_BASE}/rag:v1', '.']
images: ['${IMG_BASE}/rag:v1']
YAML
gcloud builds submit --config /tmp/cloudbuild.rag.yaml --quiet .

echo "==> Deploying RAG service"
GEMINI=$(grep '^GEMINI_API_KEY=' .env | cut -d'"' -f2)
GHTOKEN=$(grep '^GITHUB_TOKEN=' .env | cut -d'"' -f2)

gcloud run deploy gitpulse-rag \
  --image "${IMG_BASE}/rag:v1" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi \
  --quiet \
  --set-env-vars "RAG_MAX_CONTEXT_TOKENS=200000,GEMINI_API_KEY=${GEMINI},GITHUB_TOKEN=${GHTOKEN}"

RAG_URL=$(gcloud run services describe gitpulse-rag --region "$REGION" --format='value(status.url)')
echo "    RAG at ${RAG_URL}"

# ---------- Web service ----------
echo "==> Building web image via Cloud Build"
gcloud builds submit --tag "${IMG_BASE}/web:v1" --quiet .

echo "==> Building env file"
# A YAML file avoids gcloud's comma-delimiter problem with connection strings.
python3 - "$RAG_URL" <<'PY'
import sys
rag_url = sys.argv[1]
keys = ["DATABASE_URL","DIRECT_URL","AUTH_SECRET","AUTH_GITHUB_ID",
        "AUTH_GITHUB_SECRET","GITHUB_TOKEN","GEMINI_API_KEY"]
env = {}
for line in open(".env"):
    line = line.strip()
    if "=" not in line or line.startswith("#"):
        continue
    k, _, v = line.partition("=")
    if k in keys:
        env[k] = v.strip().strip('"')
env["RAG_PIPELINE_URL"] = rag_url
env["RAG_MAX_CONTEXT_TOKENS"] = "200000"
missing = [k for k in keys if not env.get(k)]
if missing:
    sys.exit("Missing values in .env: " + ", ".join(missing))
def q(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
with open("/tmp/run-env.yaml", "w") as f:
    for k, v in env.items():
        f.write(f"{k}: {q(v)}\n")
print(f"    wrote {len(env)} vars")
PY

echo "==> Deploying web service"
gcloud run deploy gitpulse-web \
  --image "${IMG_BASE}/web:v1" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --max-instances 5 \
  --quiet \
  --env-vars-file /tmp/run-env.yaml

WEB_URL=$(gcloud run services describe gitpulse-web --region "$REGION" --format='value(status.url)')

rm -f /tmp/run-env.yaml /tmp/cloudbuild.rag.yaml

cat <<EOF

================================================================
DEPLOYED

  Web : ${WEB_URL}
  RAG : ${RAG_URL}

LAST STEP - sign-in is broken until you do this:
  GitHub -> Settings -> Developer settings -> OAuth Apps -> your app
  Add this Authorization callback URL:

  ${WEB_URL}/api/auth/callback/github

================================================================
EOF
