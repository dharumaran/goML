import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Postgres did not become ready");
}

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      sku TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      sku TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);
  await pool.query(
    `INSERT INTO inventory (sku, name, stock)
     VALUES ($1, $2, $3)
     ON CONFLICT (sku) DO NOTHING`,
    [config.sku, config.productName, config.stock]
  );
}

export async function resetInventory() {
  await pool.query("TRUNCATE orders");
  await pool.query("UPDATE inventory SET stock = $1 WHERE sku = $2", [
    config.stock,
    config.sku,
  ]);
}

export async function persistOrder(orderId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE inventory
       SET stock = stock - 1
       WHERE sku = $1 AND stock > 0
       RETURNING stock`,
      [config.sku]
    );
    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, remaining: 0 };
    }
    await client.query(
      `INSERT INTO orders (id, sku, status, completed_at)
       VALUES ($1, $2, 'confirmed', NOW())`,
      [orderId, config.sku]
    );
    await client.query("COMMIT");
    return { ok: true, remaining: updated.rows[0].stock };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function dbSnapshot() {
  const inventory = await pool.query(
    "SELECT stock FROM inventory WHERE sku = $1",
    [config.sku]
  );
  const orders = await pool.query(
    "SELECT COUNT(*)::int AS count FROM orders WHERE status = 'confirmed'"
  );
  return {
    dbStock: inventory.rows[0]?.stock ?? 0,
    dbOrders: orders.rows[0]?.count ?? 0,
  };
}
