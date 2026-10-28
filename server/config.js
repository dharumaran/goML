export const config = {
  port: Number(process.env.PORT || 3000),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  databaseUrl:
    process.env.DATABASE_URL || "postgres://sale:sale@localhost:5432/flashsale",
  sku: process.env.SKU || "aether-x1",
  productName: process.env.PRODUCT_NAME || "Aether X1",
  stock: Number(process.env.STOCK || 500),
  rateLimitPerSec: Number(process.env.RATE_LIMIT || 20),
};
