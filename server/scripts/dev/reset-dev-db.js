const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

function isLikelyLocalMongo(uri = "") {
  return /localhost|127\.0\.0\.1/i.test(String(uri || ""));
}

async function resetDevDatabase() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pinkpaisa";

  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to wipe data in production");
    process.exit(1);
  }

  if (!isLikelyLocalMongo(mongoUri) && String(process.env.ALLOW_DEV_RESET || "").toLowerCase() !== "true") {
    console.error("Refusing: MONGO_URI does not look like a dev DB and ALLOW_DEV_RESET is not set");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  try {
    await mongoose.connection.collection("orders").deleteMany({});
    await mongoose.connection.collection("orderitems").deleteMany({});
    await mongoose.connection.collection("wallettransactions").deleteMany({});
    await mongoose.connection.collection("users").updateMany({}, { $set: { wallet_balance: 100000 } });
    console.log("Deleted all orders, items, transactions. Reset users to 100k wallet balance.");
  } finally {
    await mongoose.connection.close();
  }
}

resetDevDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
