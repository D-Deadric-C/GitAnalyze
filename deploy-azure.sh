#!/usr/bin/env bash
# One-shot Azure Container Apps deploy. Run after `az login`.
#
# Images are built by ACR Tasks in the cloud (`az acr build`), so only the source
# is uploaded - a few MB, not the 662MB image.
set -euo pipefail

RG=${RG:-gitpulse-rg}
LOC=${LOC:-southeastasia}          # Singapore, same city as the Neon database
ENVNAME=${ENVNAME:-gitpulse-env}
# ACR names are global and must be lowercase alphanumeric, 5-50 chars.
ACR=${ACR:-gitpulseacr$(date +%s | tail -c 6)}

echo "==> Resource group ${RG} in ${LOC}"
az group create -n "$RG" -l "$LOC" --output none

echo "==> Registering providers (slow the first time, safe to re-run)"
az provider register -n Microsoft.App --wait --output none
az provider register -n Microsoft.OperationalInsights --wait --output none
az provider register -n Microsoft.ContainerRegistry --wait --output none
az extension add --name containerapp --upgrade --only-show-errors --output none

echo "==> Container registry ${ACR}"
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true --output none
ACR_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR" -g "$RG" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" -g "$RG" --query 'passwords[0].value' -o tsv)

echo "==> Building images in ACR (uploads source only)"
az acr build -r "$ACR" -t gitpulse-rag:v1 -f rag_service/Dockerfile . --output none
az acr build -r "$ACR" -t gitpulse-web:v1 -f Dockerfile . --output none

echo "==> Container Apps environment"
az containerapp env create -n "$ENVNAME" -g "$RG" -l "$LOC" --output none

# ---- read secrets out of .env -------------------------------------------------
val() { grep "^$1=" .env | cut -d'"' -f2; }
DB_URL=$(val DATABASE_URL);        DIR_URL=$(val DIRECT_URL)
AUTH_SEC=$(val AUTH_SECRET);       GH_ID=$(val AUTH_GITHUB_ID)
GH_SEC=$(val AUTH_GITHUB_SECRET);  GH_TOK=$(val GITHUB_TOKEN)
GEMINI=$(val GEMINI_API_KEY)

for pair in "DATABASE_URL:$DB_URL" "DIRECT_URL:$DIR_URL" "AUTH_SECRET:$AUTH_SEC" \
            "AUTH_GITHUB_ID:$GH_ID" "AUTH_GITHUB_SECRET:$GH_SEC" \
            "GITHUB_TOKEN:$GH_TOK" "GEMINI_API_KEY:$GEMINI"; do
  [ -n "${pair#*:}" ] || { echo "ERROR: ${pair%%:*} is empty in .env"; exit 1; }
done

# ---- RAG service --------------------------------------------------------------
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

RAG_FQDN=$(az containerapp show -n gitpulse-rag -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
RAG_URL="https://${RAG_FQDN}"
echo "    RAG at ${RAG_URL}"

# ---- Web service --------------------------------------------------------------
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

WEB_FQDN=$(az containerapp show -n gitpulse-web -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
WEB_URL="https://${WEB_FQDN}"

cat <<EOF

================================================================
DEPLOYED TO AZURE CONTAINER APPS

  Web : ${WEB_URL}
  RAG : ${RAG_URL}

  Resource group : ${RG}
  Registry       : ${ACR_SERVER}

LAST STEP - sign-in stays broken until you do this:
  GitHub -> Settings -> Developer settings -> OAuth Apps -> your app
  Add this Authorization callback URL:

  ${WEB_URL}/api/auth/callback/github

To tear everything down later:
  az group delete -n ${RG} --yes
================================================================
EOF
