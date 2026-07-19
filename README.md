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

## REST endpoints

- `GET /health`
- `GET /passages`
- `GET /passages/:id`
- `POST /races/solo/results` — guest solo CPU results (authoritative WPM)
- `POST /sessions/public` — `{ guestSessionToken }` → `{ id }` shareable Race Code
- `GET /sessions/:id` — lobby snapshot + taken guest names

## Socket.IO (Phase 4)

Attach to the same HTTP server. Client events: `session:join`, `session:leave`, `race:start`, `session:playAgain`, `session:end`, `race:position`, `race:finish`.

Server events: `session:state`, `session:toast`, `session:error`, `race:countdown`, `race:start`, `race:positions` (~10Hz), `race:results`, `session:ended`.

Initial race countdown: 3-2-1-GO. Rematch: 5-4-3-2-1-GO. Guest names: client suggests, server enforces uniqueness.
