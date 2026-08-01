#!/usr/bin/env bash
# Fallback deploy: Azure App Service for Containers.
# Uses ONLY built-in az commands - no extension download, which is what fails
# with "Unable to stream download".
set -euo pipefail

RG=${RG:-gitpulse-rg}
LOC=${LOC:-southeastasia}
PLAN=${PLAN:-gitpulse-plan}
SUF=$(date +%s | tail -c 6)
ACR=${ACR:-gitpulseacr${SUF}}
WEB_APP=${WEB_APP:-gitpulse-web-${SUF}}
RAG_APP=${RAG_APP:-gitpulse-rag-${SUF}}

val() { grep "^$1=" .env | cut -d'"' -f2; }
DB_URL=$(val DATABASE_URL);       DIR_URL=$(val DIRECT_URL)
AUTH_SEC=$(val AUTH_SECRET);      GH_ID=$(val AUTH_GITHUB_ID)
GH_SEC=$(val AUTH_GITHUB_SECRET); GH_TOK=$(val GITHUB_TOKEN)
GEMINI=$(val GEMINI_API_KEY)

echo "==> Resource group + registry"
az group create -n "$RG" -l "$LOC" --output none
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true --output none
ACR_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR" -g "$RG" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" -g "$RG" --query 'passwords[0].value' -o tsv)

echo "==> Building RAG image in Azure (small, fast)"
az acr build -r "$ACR" -t gitpulse-rag:v1 -f rag_service/Dockerfile . --output none

echo "==> Building web image in Azure (the slow one)"
az acr build -r "$ACR" -t gitpulse-web:v1 -f Dockerfile . --output none

echo "==> App Service plan"
az appservice plan create -n "$PLAN" -g "$RG" --is-linux --sku B1 --output none

deploy_app() {
  local NAME=$1 IMAGE=$2; shift 2
  az webapp create -g "$RG" -p "$PLAN" -n "$NAME" \
    --deployment-container-image-name "${ACR_SERVER}/${IMAGE}" --output none
  az webapp config container set -g "$RG" -n "$NAME" \
    --container-image-name "${ACR_SERVER}/${IMAGE}" \
    --container-registry-url "https://${ACR_SERVER}" \
    --container-registry-user "$ACR_USER" \
    --container-registry-password "$ACR_PASS" --output none
  az webapp config appsettings set -g "$RG" -n "$NAME" --settings "$@" --output none
}

echo "==> Deploying RAG app"
deploy_app "$RAG_APP" "gitpulse-rag:v1" \
  "WEBSITES_PORT=8080" "PORT=8080" \
  "GEMINI_API_KEY=${GEMINI}" "GITHUB_TOKEN=${GH_TOK}" "RAG_MAX_CONTEXT_TOKENS=200000"
RAG_URL="https://${RAG_APP}.azurewebsites.net"

echo "==> Deploying web app"
deploy_app "$WEB_APP" "gitpulse-web:v1" \
  "WEBSITES_PORT=8080" "PORT=8080" \
  "DATABASE_URL=${DB_URL}" "DIRECT_URL=${DIR_URL}" "AUTH_SECRET=${AUTH_SEC}" \
  "AUTH_GITHUB_ID=${GH_ID}" "AUTH_GITHUB_SECRET=${GH_SEC}" \
  "GITHUB_TOKEN=${GH_TOK}" "GEMINI_API_KEY=${GEMINI}" \
  "RAG_PIPELINE_URL=${RAG_URL}" "RAG_MAX_CONTEXT_TOKENS=200000"
WEB_URL="https://${WEB_APP}.azurewebsites.net"

cat <<EOF

================================================================
DEPLOYED TO AZURE APP SERVICE

  Web : ${WEB_URL}
  RAG : ${RAG_URL}

First load takes 1-2 minutes while the container pulls. Be patient.

LAST STEP - sign-in is broken until you add this callback in
GitHub -> Settings -> Developer settings -> OAuth Apps:

  ${WEB_URL}/api/auth/callback/github

Teardown: az group delete -n ${RG} --yes
================================================================
EOF
