import { persistOrder, initSchema, waitForDb } from "./db.js";
import { config } from "./config.js";
import {
  keys,
  redis,
  setOrder,
  waitForRedis,
} from "./redis.js";

async function processOne(payload) {
  const { orderId } = JSON.parse(payload);
  const existing = await redis.hgetall(keys.order(orderId));
  const result = await persistOrder(orderId);

  if (result.ok) {
    await setOrder({
      ...existing,
      id: orderId,
      status: "confirmed",
      dbRemaining: String(result.remaining),
      completedAt: new Date().toISOString(),
    });
    await redis.incr(keys.completed);
    return;
  }

  await redis.incr(keys.remaining);
  await redis.decr(keys.reserved);
  await redis.incr(keys.failed);
  await setOrder({
    ...existing,
    id: orderId,
    status: "rejected",
    error: "Database refused the decrement",
  });
}

async function loop() {
  console.log(`Worker listening on ${keys.queue} for ${config.sku}`);
  while (true) {
    try {
      const popped = await redis.blpop(keys.queue, 5);
      if (!popped) continue;
      await processOne(popped[1]);
    } catch (err) {
      console.error("Worker error:", err);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

await waitForRedis();
await waitForDb();
await initSchema();
await loop();
