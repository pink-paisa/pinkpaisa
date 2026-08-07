const { createClient } = require("redis");
const logger = require("./logger");

const CONNECT_TIMEOUT_MS = 3000;
const MAX_INITIAL_RECONNECT_ATTEMPTS = 2;
const ERROR_LOG_THROTTLE_MS = 30000;

let clientPromise = null;
let redisClient = null;
let lastErrorLogAt = 0;

function hasRedisUrl() {
  return Boolean(String(process.env.REDIS_URL || "").trim());
}

function createRedisSocketOptions() {
  return {
    connectTimeout: CONNECT_TIMEOUT_MS,
    reconnectStrategy(retries) {
      if (retries >= MAX_INITIAL_RECONNECT_ATTEMPTS) {
        return new Error("Redis connection retry limit reached");
      }
      return Math.min(250 * (2 ** retries), 1000);
    },
  };
}

function logRedisError(err) {
  const now = Date.now();
  if (now - lastErrorLogAt < ERROR_LOG_THROTTLE_MS) return;
  lastErrorLogAt = now;
  logger.error({ err }, "redis client error");
}

async function getRedisClient() {
  if (!hasRedisUrl()) return null;
  if (redisClient?.isReady) return redisClient;
  if (!clientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: createRedisSocketOptions(),
    });
    redisClient = client;
    client.on("error", logRedisError);
    client.on("end", () => {
      if (redisClient !== client) return;
      redisClient = null;
      clientPromise = null;
    });
    clientPromise = client.connect()
      .then(() => client)
      .catch((error) => {
        if (redisClient === client) redisClient = null;
        clientPromise = null;
        if (client.isOpen) client.destroy();
        throw error;
      });
  }
  return clientPromise;
}

module.exports = {
  getRedisClient,
  hasRedisUrl,
  _private: {
    createRedisSocketOptions,
  },
};
