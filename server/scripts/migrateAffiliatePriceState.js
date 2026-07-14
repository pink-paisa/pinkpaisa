require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

const applyChanges = String(process.env.APPLY || "").toLowerCase() === "true";

function nullIfZero(value) {
  return Number(value) === 0 ? null : value ?? null;
}

function buildAffiliatePriceMigrationUpdate(product = {}) {
  const price = nullIfZero(product.price);
  const salePrice = nullIfZero(product.sale_price);
  const effectivePrice = nullIfZero(product.effective_price);
  const hasStoredPrice = [price, salePrice, effectivePrice].some((value) => Number(value) > 0);
  const observedPrice = Number(product.attributes?.imported_price_observed || 0);
  const observedSalePrice = Number(product.attributes?.imported_sale_price_observed || 0);
  const existingStatus = String(product.price_status || "");
  const reusableStatuses = new Set(["manual_unverified", "verified", "stale"]);
  const priceStatus = hasStoredPrice
    ? (reusableStatuses.has(existingStatus) ? existingStatus : "manual_unverified")
    : (observedPrice > 0 || observedSalePrice > 0 ? "manual_unverified" : "unavailable");

  return {
    price,
    sale_price: salePrice,
    effective_price: effectivePrice,
    price_status: priceStatus,
    ...(priceStatus === "verified" ? {} : { price_verified_at: null }),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/pinkpaisa");

  const products = await Product.find({
    is_affiliate: true,
    $or: [{ price: 0 }, { sale_price: 0 }, { effective_price: 0 }],
  }).select("_id price sale_price effective_price price_status attributes affiliate_data_source").lean();

  const operations = products.map((product) => {
    return {
      updateOne: {
        filter: { _id: product._id, is_affiliate: true },
        update: {
          $set: buildAffiliatePriceMigrationUpdate(product),
        },
      },
    };
  });

  if (!applyChanges) {
    console.log(JSON.stringify({ dry_run: true, matching_affiliate_products: operations.length }, null, 2));
    console.log("Run with APPLY=true to migrate only affiliate products whose price/effective_price is 0.");
    return;
  }

  const result = operations.length ? await Product.bulkWrite(operations, { ordered: false }) : null;
  console.log(JSON.stringify({
    dry_run: false,
    matched: operations.length,
    modified: result?.modifiedCount || 0,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  buildAffiliatePriceMigrationUpdate,
  main,
};
