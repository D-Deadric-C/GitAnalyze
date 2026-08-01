#!/usr/bin/env bash
# One-shot: create ECR repos, authenticate Docker, tag and push both images.
# Run after `aws configure`. Images must already be built locally.
set -euo pipefail

AWS_REGION=${AWS_REGION:-ap-southeast-1}

echo "==> Verifying credentials"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
echo "    account ${ACCOUNT_ID}, region ${AWS_REGION}"

echo "==> Creating ECR repositories (ignoring 'already exists')"
for REPO in gitpulse-web gitpulse-rag; do
  aws ecr create-repository --repository-name "$REPO" --region "$AWS_REGION" >/dev/null 2>&1 \
    && echo "    created $REPO" \
    || echo "    $REPO already exists"
done

echo "==> Authenticating Docker to ECR"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR" >/dev/null
echo "    ok"

echo "==> Tagging and pushing (this is the slow part)"
docker tag gitpulse-web:v1 "$ECR/gitpulse-web:v1"
docker tag gitpulse-rag:v1 "$ECR/gitpulse-rag:v1"
docker push "$ECR/gitpulse-web:v1"
docker push "$ECR/gitpulse-rag:v1"

cat <<EOF

================================================================
DONE. Use these image URIs in the App Runner console:

  RAG service : $ECR/gitpulse-rag:v1
  Web service : $ECR/gitpulse-web:v1

Create the RAG service FIRST - the web service needs its URL.
Port 8080 for both. See DEPLOY_AWS.md for the env vars.
================================================================
EOF
