#!/usr/bin/env bash
#
# Local/manual backend deploy for price-insight.
#
# PRIMARY deploy path is CI: .github/workflows/build.yml + deploy.yml
# (workflow_dispatch). This script mirrors that flow for local/emergency
# deploys and enforces the same ordering:
#
#   build+push image  ->  apply DB migrations  ->  deploy backend service
#
# Cloud Run serves via `node dist/server.js`, which does NOT run migrations,
# so the backend-migrate Cloud Run Job must apply pending Drizzle migrations
# on the new image BEFORE the service revision goes live. If migrations fail,
# the script aborts (set -e) and the service is NOT deployed.
#
# Requirements: gcloud (authenticated), docker, Artifact Registry access, and
# the backend-migrate / backend Cloud Run resources provisioned via Terraform.
#
# Usage:
#   ./infra/deploy-backend.sh                 # build+push+migrate+deploy HEAD
#   PROJECT_ID=wd-tools REGION=... ./infra/deploy-backend.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-wd-tools}"
REGION="${REGION:-australia-southeast1}"
GAR_HOST="${REGION}-docker.pkg.dev"
BACKEND_IMAGE="${BACKEND_IMAGE:-${GAR_HOST}/${PROJECT_ID}/price-insight/price-insight-backend}"

# Run from repo root regardless of where the script is invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SHA="$(git rev-parse HEAD)"
IMAGE_TAG="${BACKEND_IMAGE}:${SHA}"

echo "==> Building backend image (${SHA})"
# Mirrors build.yml: context is repo root, Dockerfile under apps/backend.
docker build -f apps/backend/Dockerfile -t "$IMAGE_TAG" .

echo "==> Pushing image to Artifact Registry"
gcloud auth configure-docker "$GAR_HOST" --quiet
docker push "$IMAGE_TAG"

echo "==> Resolving pushed digest"
DIGEST="$(gcloud artifacts docker images describe "$IMAGE_TAG" \
  --format='value(image_summary.digest)')"
IMAGE_REF="${BACKEND_IMAGE}@${DIGEST}"
echo "    ${IMAGE_REF}"

echo "==> Applying DB migrations via backend-migrate Job"
gcloud run jobs update backend-migrate \
  --image="$IMAGE_REF" \
  --region="$REGION" --project="$PROJECT_ID"
gcloud run jobs execute backend-migrate \
  --region="$REGION" --project="$PROJECT_ID" --wait

echo "==> Deploying backend service"
gcloud run deploy backend \
  --image="$IMAGE_REF" \
  --region="$REGION" --project="$PROJECT_ID"

echo "==> Done. Deployed ${IMAGE_REF}"
