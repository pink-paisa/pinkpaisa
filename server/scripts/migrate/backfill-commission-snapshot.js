const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const OrderItem = require("../../models/OrderItem");
const Vendor = require("../../models/Vendor");

function calculatePayoutBreakup(price, quantity, commissionPercent = 20) {
  const gross = Number(price || 0) * Number(quantity || 0);
  const commissionAmount = Number((gross * Number(commissionPercent || 20)) / 100);
  return { commissionAmount, payoutAmount: gross - commissionAmount };
}

async function run() {
  await connectDB();

  const items = await OrderItem.find({
    vendor_id: { $ne: null },
    $or: [
      { commission_percent: null },
      { commission_amount: null },
      { payout_amount: null },
    ],
  });

  let updated = 0;
  for (const item of items) {
    const vendor = await Vendor.findById(item.vendor_id).select("commission_percent").lean();
    const commissionPercent = Number(vendor?.commission_percent || 20);
    const breakup = calculatePayoutBreakup(item.price, item.quantity, commissionPercent);
    item.$locals = { ...(item.$locals || {}), allowPayoutSnapshotOverride: true };
    item.commission_percent = commissionPercent;
    item.commission_amount = breakup.commissionAmount;
    item.payout_amount = breakup.payoutAmount;
    await item.save();
    updated += 1;
  }

  console.log(`Backfilled commission snapshot for ${updated} order item(s).`);
  await mongoose.connection.close();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close().catch(() => null);
  process.exit(1);
});
