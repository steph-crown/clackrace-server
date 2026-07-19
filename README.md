# ClackRace Server

Single Node.js process: Fastify (REST + future SSE) + Socket.IO (Phase 4). Postgres via Drizzle. Redis for ephemeral live state (Phase 4+).

## Setup

```bash
# 1. Install deps
pnpm install

# 2. Start Postgres + Redis
# Postgres is published on host port 5433 (not 5432) so it won't clash
# with a local Postgres install.
docker compose up -d

# 3. Env
cp .env.example .env

# 4. Push schema + seed passages
pnpm db:push
pnpm db:seed

# 5. Run
pnpm dev
```

API defaults to `http://localhost:4000`.

## Phase 3 endpoints

- `GET /health`
- `GET /passages`
- `GET /passages/:id`
- `POST /races/solo/results` — persists guest solo CPU runs; WPM/accuracy recomputed server-side from keystrokes
