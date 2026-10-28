const els = {
  stockLine: document.getElementById("stockLine"),
  barFill: document.getElementById("barFill"),
  buyBtn: document.getElementById("buyBtn"),
  orderStatus: document.getElementById("orderStatus"),
  startBtn: document.getElementById("startBtn"),
  rushBtn: document.getElementById("rushBtn"),
  mRemaining: document.getElementById("mRemaining"),
  mOrders: document.getElementById("mOrders"),
  mQueue: document.getElementById("mQueue"),
  mOversold: document.getElementById("mOversold"),
};

let locked = false;
let pollTimer = 0;

async function getStatus() {
  const res = await fetch("/api/status");
  return res.json();
}

function render(status) {
  const cap = status.product.cap;
  const left = status.redisRemaining;
  els.mRemaining.textContent = String(left);
  els.mOrders.textContent = String(status.dbOrders);
  els.mQueue.textContent = String(status.queueLength);
  els.mOversold.textContent = status.oversold ? "YES" : "No";
  els.mOversold.style.color = status.oversold ? "#8b1212" : "#1f6b4a";
  els.barFill.style.width = `${Math.max(0, (left / cap) * 100)}%`;

  if (!status.saleLive) {
    els.stockLine.textContent = "Sale is armed but not live";
    if (!locked) {
      els.buyBtn.disabled = true;
      els.buyBtn.textContent = "Start the sale first";
    }
    return;
  }

  if (left <= 0) {
    els.stockLine.textContent = "Sold out";
    if (!locked) {
      els.buyBtn.disabled = true;
      els.buyBtn.textContent = "Sold out";
    }
    return;
  }

  els.stockLine.textContent = `${left} of ${cap} tokens left`;
  if (!locked) {
    els.buyBtn.disabled = false;
    els.buyBtn.textContent = "Buy now";
  }
}

async function refresh() {
  try {
    render(await getStatus());
  } catch {
    els.stockLine.textContent = "API unreachable";
  }
}

async function pollOrder(orderId) {
  for (let i = 0; i < 40; i += 1) {
    const res = await fetch(`/api/orders/${orderId}`);
    const order = await res.json();
    els.orderStatus.textContent = `Order ${order.status}`;
    if (order.status === "confirmed" || order.status === "rejected") {
      await refresh();
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

els.buyBtn.addEventListener("click", async () => {
  if (locked || els.buyBtn.disabled) return;
  locked = true;
  els.buyBtn.classList.add("locked");
  els.buyBtn.disabled = true;
  els.buyBtn.textContent = "Reserving…";
  els.orderStatus.textContent = "Locked the button after the first click";

  try {
    const res = await fetch("/api/checkout", { method: "POST" });
    const body = await res.json();
    if (res.status === 202) {
      els.orderStatus.textContent = `Queued ${body.orderId.slice(0, 8)}…`;
      await pollOrder(body.orderId);
      els.buyBtn.textContent = "You are in";
      return;
    }
    els.orderStatus.textContent = body.error || "Checkout failed";
    els.buyBtn.textContent = body.error || "Failed";
  } catch {
    els.orderStatus.textContent = "Network error";
  } finally {
    await refresh();
  }
});

els.startBtn.addEventListener("click", async () => {
  locked = false;
  els.buyBtn.classList.remove("locked");
  els.orderStatus.textContent = "";
  await fetch("/api/sale/start", { method: "POST" });
  await refresh();
});

els.rushBtn.addEventListener("click", async () => {
  els.orderStatus.textContent = "Firing 2,000 parallel reserves on the server…";
  const rushRes = await fetch("/api/demo/rush", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: 2000 }),
  });
  const rush = await rushRes.json();
  const accepted = rush.accepted;
  els.orderStatus.textContent = `${accepted} tokens reserved. Waiting for workers…`;

  const start = Date.now();
  while (Date.now() - start < 20000) {
    const status = await getStatus();
    render(status);
    if (status.queueLength === 0 && status.dbOrders >= accepted) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const done = await getStatus();
  render(done);
  els.orderStatus.textContent = done.oversold
    ? "Failed: oversold"
    : `Rush complete. Confirmed ${done.dbOrders}/${done.product.cap}, oversold=${done.oversold}`;
});

pollTimer = setInterval(refresh, 1000);
refresh();
