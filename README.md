# Flash-sale placement demo

Working demo for the fullstack case study: **500 phones**, a traffic spike, and **zero overselling**.

## Architecture

1. The buy button locks on the first click so the browser cannot spam checkout.
2. `POST /api/checkout` atomically decrements a Redis token with a Lua script. If Redis says no, the request never reaches Postgres.
3. A successful reserve returns **202 Accepted** and pushes work onto a Redis list.
4. A worker pops that queue and runs:

```sql
UPDATE inventory SET stock = stock - 1
WHERE sku = $1 AND stock > 0
```

That conditional update is the last guardrail. Confirmed rows cannot exceed 500.

## Run

Docker Desktop must be running.

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Reset & start sale**.
2. Click **Buy now** once — the button stays locked while the order is queued, then confirmed.
3. Click **Simulate 2,000-user rush**. Metrics should end at **500 confirmed**, **0 remaining**, **Oversold? No**.

CLI equivalent (from another terminal):

```bash
docker compose exec api node scripts/load-test.js
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/status` | Redis tokens, queue depth, Postgres counts, oversell flag |
| POST | `/api/sale/start` | Reset stock to 500 and open the sale |
| POST | `/api/checkout` | Reserve a token, enqueue persistence, return 202 |
| GET | `/api/orders/:id` | Poll queued → confirmed \| rejected |
