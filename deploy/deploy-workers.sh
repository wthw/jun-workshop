#!/usr/bin/env bash
# Builds the shared container image and deploys the three worker agents to Cloud Run.
# All three share one image; the AGENT env var selects which service starts inside it.
set -euo pipefail

# Reads your active gcloud project automatically — set it first with:
#   gcloud config set project YOUR_PROJECT_ID
PROJECT="$(gcloud config get-value project)"
REGION="${REGION:-us-central1}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/techparts/agents:latest"

# ── REQUIRED: your AI Studio key from https://aistudio.google.com/apikey ──────
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
if [[ -z "$GEMINI_API_KEY" ]]; then
  echo "ERROR: set GEMINI_API_KEY before running this script."
  echo "  export GEMINI_API_KEY=your_key_here"
  exit 1
fi

# ── Build and push the image via Cloud Build (no local Docker required) ────────
echo "==> Building container image with Cloud Build..."
# Run from repo root (one level up from this script)
gcloud builds submit \
  --tag "$IMAGE" \
  --project "$PROJECT" \
  "$(dirname "$0")/.."

echo ""
echo "==> Deploying worker agents to Cloud Run..."

for AGENT in inventory orders pricing; do
  echo "--- deploying ${AGENT}-agent ---"
  gcloud run deploy "${AGENT}-agent" \
    --image "$IMAGE" \
    --region "$REGION" \
    --project "$PROJECT" \
    --set-env-vars "AGENT=${AGENT},GEMINI_API_KEY=${GEMINI_API_KEY}" \
    --allow-unauthenticated \
    --port 8080 \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 3
  echo "✓ ${AGENT}-agent deployed"
done

echo ""
echo "==> Worker URLs:"
for AGENT in inventory orders pricing; do
  URL=$(gcloud run services describe "${AGENT}-agent" \
    --region "$REGION" \
    --project "$PROJECT" \
    --format "value(status.url)")
  echo "  ${AGENT}: ${URL}"
done

echo ""
echo "Next: deploy the orchestrator to Vertex AI Agent Engine (see DEPLOYMENT.md Part 4)"
