const mongoose = require("mongoose");
const logger = require("../utils/logger");

let listenersRegistered = false;

function registerConnectionListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on("error", (error) => {
    logger.error({ err: error }, "mongo error");
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("mongo disconnected");
  });
}

const connectDB = async () => {
  registerConnectionListeners();
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/pinkpaisa";

  while (true) {
    try {
      const conn = await mongoose.connect(uri, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryWrites: true,
      });
      logger.info({ host: conn.connection.host }, "mongo connected");
      return conn;
    } catch (err) {
      logger.error({ err }, "mongo connection failed, retrying in 5s");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

module.exports = connectDB;
