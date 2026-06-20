# Deploying TechParts Agents on GCP

This guide walks through deploying all four agents to Google Cloud — step by step.

**Architecture:**
```
inventory-agent  ┐
orders-agent     ├── Cloud Run  (3 independent services, TypeScript)
pricing-agent    ┘
                        ↕ A2A over HTTPS
ops-orchestrator ──── Vertex AI Agent Engine  (Python, managed runtime)
```

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| gcloud CLI | any | `gcloud version` |
| Python | 3.10+ | `python3 --version` |
| Logged in | — | `gcloud auth list` |

Set your project once, so every command below picks it up automatically:

```bash
gcloud config set project {GCP_PROJECT_ID}
gcloud config set compute/region us-central1
```

---

## Part 1 — One-time Setup

> Run this once. It enables the GCP APIs and creates the resources every step below depends on.

**Enable required APIs:**
```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com
```

**Create a Docker repository in Artifact Registry:**
```bash
gcloud artifacts repositories create techparts \
  --repository-format=docker \
  --location=us-central1 \
  --description="TechParts workshop images"
```

> Artifact Registry is where your container images live — like Docker Hub, but private and inside GCP.

---

## Part 2 — Build the Container Image

> One image serves all three workers. The `AGENT` environment variable at runtime
> decides which agent starts inside it.

**Build and push to Artifact Registry using Cloud Build:**
```bash
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/$(gcloud config get-value project)/techparts/agents:latest \
  .
```

> Cloud Build runs the build in the cloud — no Docker installation needed on your machine.
> It reads the `Dockerfile` at the repo root, builds it, and pushes the image automatically.

---

## Part 3 — Deploy Workers to Cloud Run

> Each agent gets its own Cloud Run service. They share the same image but run independently.
> Replace `YOUR_GEMINI_API_KEY` with your key from https://aistudio.google.com/apikey

**Deploy inventory agent:**
```bash
gcloud run deploy inventory-agent \
  --image us-central1-docker.pkg.dev/$(gcloud config get-value project)/techparts/agents:latest \
  --region us-central1 \
  --set-env-vars "AGENT=inventory,GEMINI_API_KEY=YOUR_GEMINI_API_KEY" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi
```

**Deploy orders agent:**
```bash
gcloud run deploy orders-agent \
  --image us-central1-docker.pkg.dev/$(gcloud config get-value project)/techparts/agents:latest \
  --region us-central1 \
  --set-env-vars "AGENT=orders,GEMINI_API_KEY=YOUR_GEMINI_API_KEY" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi
```

**Deploy pricing agent:**
```bash
gcloud run deploy pricing-agent \
  --image us-central1-docker.pkg.dev/$(gcloud config get-value project)/techparts/agents:latest \
  --region us-central1 \
  --set-env-vars "AGENT=pricing,GEMINI_API_KEY=YOUR_GEMINI_API_KEY" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi
```

> Each deployment prints a **Service URL** when it finishes. Open it in a browser —
> every agent has a built-in debug console showing conversations and tool calls in real time.

**Check all three are running:**
```bash
gcloud run services list --region us-central1
```

---

## Part 4 — Deploy Orchestrator to Vertex AI Agent Engine

> The orchestrator is a Python ADK agent deployed to Vertex AI Agent Engine —
> Google's **managed runtime** for AI agents. You deploy the code; Google manages the infrastructure.
> It connects to the three Cloud Run workers above using the A2A protocol.

**Step 4a — Set up the Python environment:**

```bash
python3 -m venv deploy/venv
source deploy/venv/bin/activate
pip install "google-adk[a2a]" "google-cloud-aiplatform[agent_engines]"
```

> This creates a virtual environment under `deploy/venv/` (git-ignored — not pushed to the repo).
> Every terminal session that runs `adk` commands must activate it first with:
> `source deploy/venv/bin/activate`
> Your prompt will show `(venv)` when it's active. To deactivate: `deactivate`.

**Step 4b — Create a GCS bucket for Agent Engine staging:**
```bash
gcloud storage buckets create gs://$(gcloud config get-value project)-agent-engine-staging \
  --location=us-central1
```

> Agent Engine needs a Cloud Storage bucket to package your agent before deploying it.

**Step 4c — Deploy using the ADK CLI:**
```bash
python3 -m venv deploy/venv
source deploy/venv/bin/activate
pip install "google-adk[a2a]" "google-cloud-aiplatform[agent_engines]"

adk deploy agent_engine \
  --project=$(gcloud config get-value project) \
  --region=us-central1 \
  --display_name="TechParts Orchestrator" \
  deploy/agent_engine/
```

> This packages `deploy/agent_engine/agent.py`, uploads it to GCS, and creates a
> managed Reasoning Engine on Vertex AI. Takes about 2-3 minutes.

When it finishes, you'll see a **Playground link** in the output. Open it to test the
orchestrator directly from the Vertex AI console.

**Try this query in the Playground:**
```
Customer 1042 wants to return their headphones and get something similar — what can we offer?
```

> Watch it call the orders agent, inventory agent, and pricing agent — all over A2A —
> and synthesize one recommendation. TypeScript workers, Python orchestrator, A2A protocol
> connecting them across languages and platforms.

---

## What you just deployed

| Agent | Platform | Language | Model auth |
|---|---|---|---|
| inventory-agent | Cloud Run | TypeScript | AI Studio API key |
| orders-agent | Cloud Run | TypeScript | AI Studio API key |
| pricing-agent | Cloud Run | TypeScript | AI Studio API key |
| ops-orchestrator | Vertex AI Agent Engine | Python | Vertex AI service agent (automatic) |

---

## Security note — locking down Cloud Run

Right now the three worker URLs are public (`--allow-unauthenticated`), which is fine
for a workshop. In production you lock them down with IAM.

**Step 1 — Create a service account for the orchestrator to call the workers:**

```bash
gcloud iam service-accounts create techparts-orchestrator \
  --display-name="TechParts Orchestrator"
```

**Step 2 — Remove public access from each worker:**

```bash
gcloud run services update inventory-agent --region us-central1 --no-allow-unauthenticated
gcloud run services update orders-agent    --region us-central1 --no-allow-unauthenticated
gcloud run services update pricing-agent   --region us-central1 --no-allow-unauthenticated
```

**Step 3 — Grant the service account permission to invoke each worker:**

```bash
for SERVICE in inventory-agent orders-agent pricing-agent; do
  gcloud run services add-iam-policy-binding $SERVICE \
    --region us-central1 \
    --member="serviceAccount:techparts-orchestrator@$(gcloud config get-value project).iam.gserviceaccount.com" \
    --role="roles/run.invoker"
done
```

> Now only identities holding that service account can call the workers.
> The orchestrator running in Agent Engine would attach this identity token automatically
> when making A2A calls — no API keys, fully IAM-controlled.

---

## Automated Scripts

Want to deploy everything in one go? The repo includes scripts that run all the commands above:

```bash
# One-time setup
bash deploy/setup.sh

# Build image + deploy 3 Cloud Run workers
export GEMINI_API_KEY=your_key_here
bash deploy/deploy-workers.sh

# Deploy orchestrator to Vertex AI Agent Engine
source deploy/venv/bin/activate
adk deploy agent_engine \
  --project=$(gcloud config get-value project) \
  --region=us-central1 \
  --display_name="TechParts Orchestrator" \
  deploy/agent_engine/
```
