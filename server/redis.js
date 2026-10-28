import Redis from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const keys = {
  remaining: `sale:${config.sku}:remaining`,
  reserved: `sale:${config.sku}:reserved`,
  live: `sale:${config.sku}:live`,
  queue: `sale:${config.sku}:queue`,
  completed: `sale:${config.sku}:completed`,
  failed: `sale:${config.sku}:failed`,
  order: (id) => `sale:order:${id}`,
  rate: (ip) => `rl:${ip}:${Math.floor(Date.now() / 1000)}`,
};

const RESERVE_LUA = `
local remaining = tonumber(redis.call('GET', KEYS[1]) or '0')
local live = redis.call('GET', KEYS[3])
if live ~= '1' then
  return {-2, remaining}
end
if remaining <= 0 then
  return {-1, remaining}
end
remaining = redis.call('DECR', KEYS[1])
redis.call('INCR', KEYS[2])
return {1, remaining}
`;

export async function waitForRedis(retries = 30) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const pong = await redis.ping();
      if (pong === "PONG") return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Redis did not become ready");
}

export async function startSale() {
  const pipeline = redis.multi();
  pipeline.set(keys.remaining, config.stock);
  pipeline.set(keys.reserved, 0);
  pipeline.set(keys.completed, 0);
  pipeline.set(keys.failed, 0);
  pipeline.set(keys.live, "1");
  pipeline.del(keys.queue);
  await pipeline.exec();
}

export async function reserveToken() {
  const [ok, remaining] = await redis.eval(
    RESERVE_LUA,
    3,
    keys.remaining,
    keys.reserved,
    keys.live
  );
  return { ok: Number(ok), remaining: Number(remaining) };
}

export async function enqueueCheckout(payload) {
  await redis.rpush(keys.queue, JSON.stringify(payload));
}

export async function setOrder(order) {
  await redis.hset(keys.order(order.id), order);
  await redis.expire(keys.order(order.id), 60 * 60);
}

export async function getOrder(id) {
  const data = await redis.hgetall(keys.order(id));
  if (!data || !data.id) return null;
  return data;
}

export async function redisSnapshot() {
  const [remaining, reserved, live, completed, failed] = await redis.mget(
    keys.remaining,
    keys.reserved,
    keys.live,
    keys.completed,
    keys.failed
  );
  const queueLength = await redis.llen(keys.queue);
  return {
    saleLive: live === "1",
    redisRemaining: Number(remaining ?? 0),
    redisReserved: Number(reserved ?? 0),
    queueLength,
    completed: Number(completed ?? 0),
    failed: Number(failed ?? 0),
  };
}

export async function rateLimit(ip) {
  const key = keys.rate(ip);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 2);
  return count <= config.rateLimitPerSec;
}
