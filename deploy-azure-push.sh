#!/usr/bin/env bash
# Azure for Students blocks ACR Tasks (TasksOperationsNotAllowed), so build
# locally and push, instead of `az acr build`. Both images already exist locally.
set -euo pipefail

RG=${RG:-gitpulse-rg2}
LOC=${LOC:-centralindia}
ENVNAME=${ENVNAME:-gitpulse-env}

echo "==> Finding registry in ${RG}"
ACR=$(az acr list -g "$RG" --query '[0].name' -o tsv)
[ -n "$ACR" ] || { echo "No registry found in $RG"; exit 1; }
ACR_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR" -g "$RG" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" -g "$RG" --query 'passwords[0].value' -o tsv)
echo "    ${ACR_SERVER}"

echo "==> Docker login"
printf '%s' "$ACR_PASS" | docker login "$ACR_SERVER" -u "$ACR_USER" --password-stdin >/dev/null

echo "==> Pushing RAG image (282MB)"
docker tag gitpulse-rag:v1 "${ACR_SERVER}/gitpulse-rag:v1"
docker push "${ACR_SERVER}/gitpulse-rag:v1"

echo "==> Pushing web image (662MB - the slow one)"
docker tag gitpulse-web:v1 "${ACR_SERVER}/gitpulse-web:v1"
docker push "${ACR_SERVER}/gitpulse-web:v1"

echo "==> Container Apps environment"
# Only skip when it genuinely exists; never mask a creation failure.
if az containerapp env show -n "$ENVNAME" -g "$RG" --output none 2>/dev/null; then
  echo "    exists"
else
  az containerapp env create -n "$ENVNAME" -g "$RG" -l "$LOC" --output none
fi

val() { grep "^$1=" .env | cut -d'"' -f2; }
DB_URL=$(val DATABASE_URL);       DIR_URL=$(val DIRECT_URL)
AUTH_SEC=$(val AUTH_SECRET);      GH_ID=$(val AUTH_GITHUB_ID)
GH_SEC=$(val AUTH_GITHUB_SECRET); GH_TOK=$(val GITHUB_TOKEN)
GEMINI=$(val GEMINI_API_KEY)

echo "==> Deploying RAG service"
az containerapp create -n gitpulse-rag -g "$RG" --environment "$ENVNAME" \
  --image "${ACR_SERVER}/gitpulse-rag:v1" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 8080 --ingress external \
  --cpu 0.5 --memory 1Gi --min-replicas 0 --max-replicas 2 \
  --secrets "gemini=${GEMINI}" "ghtoken=${GH_TOK}" \
  --env-vars "GEMINI_API_KEY=secretref:gemini" "GITHUB_TOKEN=secretref:ghtoken" \
             "RAG_MAX_CONTEXT_TOKENS=200000" \
  --output none

RAG_URL="https://$(az containerapp show -n gitpulse-rag -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"
echo "    ${RAG_URL}"

echo "==> Deploying web service"
az containerapp create -n gitpulse-web -g "$RG" --environment "$ENVNAME" \
  --image "${ACR_SERVER}/gitpulse-web:v1" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 8080 --ingress external \
  --cpu 1 --memory 2Gi --min-replicas 1 --max-replicas 3 \
  --secrets "dburl=${DB_URL}" "directurl=${DIR_URL}" "authsecret=${AUTH_SEC}" \
            "ghid=${GH_ID}" "ghsecret=${GH_SEC}" "ghtoken=${GH_TOK}" "gemini=${GEMINI}" \
  --env-vars "DATABASE_URL=secretref:dburl" "DIRECT_URL=secretref:directurl" \
             "AUTH_SECRET=secretref:authsecret" "AUTH_GITHUB_ID=secretref:ghid" \
             "AUTH_GITHUB_SECRET=secretref:ghsecret" "GITHUB_TOKEN=secretref:ghtoken" \
             "GEMINI_API_KEY=secretref:gemini" \
             "RAG_PIPELINE_URL=${RAG_URL}" "RAG_MAX_CONTEXT_TOKENS=200000" \
  --output none

WEB_URL="https://$(az containerapp show -n gitpulse-web -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"

cat <<EOF

================================================================
LIVE ON AZURE CONTAINER APPS

  Web : ${WEB_URL}
  RAG : ${RAG_URL}

PASTE THIS into the GitHub OAuth callback field you have open:

  ${WEB_URL}/api/auth/callback/github

================================================================
EOF
