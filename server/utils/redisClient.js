const { createClient } = require("redis");
const logger = require("./logger");

let clientPromise = null;

function hasRedisUrl() {
  return Boolean(String(process.env.REDIS_URL || "").trim());
}

async function getRedisClient() {
  if (!hasRedisUrl()) return null;
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => logger.error({ err }, "redis client error"));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

module.exports = {
  getRedisClient,
  hasRedisUrl,
};
