"""
Deploy TechParts orchestrator to Vertex AI Agent Engine.

Prerequisites:
  cd <repo-root>
  python3.13 -m venv deploy/venv
  source deploy/venv/bin/activate
  pip install "google-adk[a2a]" "google-cloud-aiplatform[agent_engines]"

Deploy — first time (run from repo root):
  source deploy/venv/bin/activate
  adk deploy agent_engine \\
    --project=YOUR_PROJECT_ID \\
    --region=us-central1 \\
    --display_name="TechParts Orchestrator" \\
    deploy/agent_engine/

Update existing deployment:
  adk deploy agent_engine \\
    --project=YOUR_PROJECT_ID \\
    --region=us-central1 \\
    --display_name="TechParts Orchestrator" \\
    --agent_engine_id=<resource_id_from_previous_deploy> \\
    deploy/agent_engine/

After deploying, the Playground URL is printed on success and also visible in the
  Vertex AI console: https://console.cloud.google.com/vertex-ai/agents/reasoning-engines

The Playground will be available at the URL printed on success.
Workers (inventory, orders, pricing) must already be deployed to Cloud Run.
"""

# This file is documentation only — deployment is done via the adk CLI above.
# See agent.py for the orchestrator agent definition.
