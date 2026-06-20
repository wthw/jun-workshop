#!/usr/bin/env bash
# One-time GCP project setup. Run this once before the first deployment.
set -euo pipefail

# Reads your active gcloud project automatically — set it first with:
#   gcloud config set project YOUR_PROJECT_ID
PROJECT="$(gcloud config get-value project)"
REGION="${REGION:-us-central1}"
SA_NAME="techparts-orchestrator"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "==> Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  --project="$PROJECT"

echo "==> Creating Artifact Registry repository..."
gcloud artifacts repositories create techparts \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT" \
  --description="TechParts workshop container images" 2>/dev/null \
  || echo "    (repository already exists, skipping)"

echo "==> Creating service account for orchestrator..."
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="TechParts Orchestrator (Vertex AI)" \
  --project="$PROJECT" 2>/dev/null \
  || echo "    (service account already exists, skipping)"

echo "==> Granting Vertex AI User role to orchestrator service account..."
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user" \
  --condition=None

echo ""
echo "Setup complete."
echo ""
echo "Next steps:"
echo "  1. Run: deploy/deploy-workers.sh   (builds image + deploys inventory/orders/pricing)"
echo "  2. Run: deploy/deploy-workers.sh   (builds image + deploys inventory/orders/pricing)"
echo "  3. Run: adk deploy agent_engine ... (deploys orchestrator to Vertex AI Agent Engine)"
