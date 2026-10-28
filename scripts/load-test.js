const base = process.env.BASE_URL || "http://localhost:3000";
const rush = Number(process.env.RUSH || 2000);

async function json(path, options) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function waitUntilDrained(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body } = await json("/api/status");
    if (body.queueLength === 0 && body.completed + body.failed >= body.redisReserved) {
      return body;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for the queue to drain");
}

const started = await json("/api/sale/start", { method: "POST" });
if (!started.body.ok) {
  console.error("Could not start sale", started);
  process.exit(1);
}

console.log(`Rushing ${rush} parallel checkouts against a cap of ${started.body.product?.cap ?? 500}`);

const results = await Promise.allSettled(
  Array.from({ length: rush }, () =>
    json("/api/checkout", {
      method: "POST",
      headers: { "x-demo-rush": "1" },
    })
  )
);

const counts = { accepted: 0, soldOut: 0, other: 0, errors: 0 };
for (const result of results) {
  if (result.status !== "fulfilled") {
    counts.errors += 1;
    continue;
  }
  if (result.value.status === 202) counts.accepted += 1;
  else if (result.value.status === 409) counts.soldOut += 1;
  else counts.other += 1;
}

const finalStatus = await waitUntilDrained();
const ok =
  counts.accepted === finalStatus.product.cap &&
  finalStatus.dbOrders === finalStatus.product.cap &&
  finalStatus.dbStock === 0 &&
  finalStatus.redisRemaining === 0 &&
  !finalStatus.oversold;

console.log({
  accepted: counts.accepted,
  soldOut: counts.soldOut,
  other: counts.other,
  errors: counts.errors,
  dbOrders: finalStatus.dbOrders,
  dbStock: finalStatus.dbStock,
  redisRemaining: finalStatus.redisRemaining,
  oversold: finalStatus.oversold,
  pass: ok,
});

process.exit(ok ? 0 : 1);
