FROM node:24-slim

WORKDIR /app

# Copy workspace manifest files first so npm install is cached separately from source
COPY package*.json ./
COPY shared/package.json ./shared/
COPY agents/inventory/package.json ./agents/inventory/
COPY agents/orders/package.json ./agents/orders/
COPY agents/pricing/package.json ./agents/pricing/
COPY agents/orchestrator/package.json ./agents/orchestrator/

RUN npm install

# Copy all source (DB is not in git; it is seeded at startup instead)
COPY . .

EXPOSE 8080

# Seed SQLite at each startup so order dates stay fresh (the 30-day return window demo
# depends on relative dates — baking the DB into the image would make it stale).
# AGENT env var selects which service to run: inventory | orders | pricing | orchestrator
CMD node --import tsx/esm shared/src/seed.ts && node --import tsx/esm agents/$AGENT/src/server.ts
