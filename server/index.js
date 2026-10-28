import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { dbSnapshot, initSchema, resetInventory, waitForDb } from "./db.js";
import {
  enqueueCheckout,
  getOrder,
  rateLimit,
  redisSnapshot,
  reserveToken,
  setOrder,
  startSale,
  waitForRedis,
} from "./redis.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

app.get("/api/status", async (_req, res) => {
  const [redisStatus, dbStatus] = await Promise.all([
    redisSnapshot(),
    dbSnapshot(),
  ]);
  const oversold = dbStatus.dbOrders > config.stock;
  res.json({
    product: { sku: config.sku, name: config.productName, cap: config.stock },
    ...redisStatus,
    ...dbStatus,
    oversold,
  });
});

app.post("/api/sale/start", async (_req, res) => {
  await resetInventory();
  await startSale();
  const [redisStatus, dbStatus] = await Promise.all([
    redisSnapshot(),
    dbSnapshot(),
  ]);
  res.json({ ok: true, ...redisStatus, ...dbStatus });
});

app.post("/api/checkout", async (req, res) => {
  const ip = clientIp(req);
  const rush = req.get("x-demo-rush") === "1";
  if (!rush) {
    const allowed = await rateLimit(ip);
    if (!allowed) {
      return res.status(429).json({ error: "Too many requests" });
    }
  }

  const reservation = await reserveToken();
  if (reservation.ok === -2) {
    return res.status(403).json({ error: "Sale is not live" });
  }
  if (reservation.ok !== 1) {
    return res.status(409).json({
      error: "Sold out",
      remaining: reservation.remaining,
    });
  }

  const orderId = crypto.randomUUID();
  const order = {
    id: orderId,
    sku: config.sku,
    status: "queued",
    remaining: String(reservation.remaining),
    createdAt: new Date().toISOString(),
  };
  await setOrder(order);
  await enqueueCheckout({ orderId, sku: config.sku });

  return res.status(202).json({
    orderId,
    status: "queued",
    remaining: reservation.remaining,
    statusUrl: `/api/orders/${orderId}`,
  });
});

app.get("/api/orders/:id", async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

app.post("/api/demo/rush", async (req, res) => {
  const n = Math.min(Number(req.body?.count || 2000), 5000);
  await resetInventory();
  await startSale();

  const results = await Promise.all(
    Array.from({ length: n }, async () => {
      const reservation = await reserveToken();
      if (reservation.ok !== 1) return "sold_out";
      const orderId = crypto.randomUUID();
      await setOrder({
        id: orderId,
        sku: config.sku,
        status: "queued",
        remaining: String(reservation.remaining),
        createdAt: new Date().toISOString(),
      });
      await enqueueCheckout({ orderId, sku: config.sku });
      return "accepted";
    })
  );

  res.json({
    attempted: n,
    accepted: results.filter((r) => r === "accepted").length,
    soldOut: results.filter((r) => r === "sold_out").length,
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

await waitForRedis();
await waitForDb();
await initSchema();

app.listen(config.port, () => {
  console.log(`Flash sale API on http://localhost:${config.port}`);
});
