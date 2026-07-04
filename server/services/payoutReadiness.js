const OrderItem = require("../models/OrderItem");
const { refreshPayoutReadinessForOrder } = require("../controllers/orderController");
const logger = require("../utils/logger");

function getEligibilityDate(item) {
  if (!item?.delivered_at) return null;
  const eligibleAt = new Date(item.delivered_at);
  eligibleAt.setDate(eligibleAt.getDate() + Number(item.return_window_days || 0));
  return eligibleAt;
}

async function sweepVendorPayoutReadiness({ vendorId = null, now = new Date() } = {}) {
  const query = {
    payout_status: "on_hold",
    vendor_status: "delivered",
    return_status: { $in: ["not_requested", "rejected"] },
    delivered_at: { $ne: null },
  };

  if (vendorId) query.vendor_id = vendorId;

  const candidates = await OrderItem.find(query)
    .select("_id order_id delivered_at return_window_days")
    .lean();

  const readyIds = [];
  const touchedOrderIds = new Set();

  for (const item of candidates) {
    const eligibleAt = getEligibilityDate(item);
    if (eligibleAt && eligibleAt <= now) {
      readyIds.push(item._id);
      if (item.order_id) touchedOrderIds.add(String(item.order_id));
    }
  }

  if (!readyIds.length) {
    return { ready_count: 0, order_count: 0 };
  }

  await OrderItem.updateMany(
    { _id: { $in: readyIds } },
    { $set: { payout_status: "ready" } },
  );

  for (const orderId of touchedOrderIds) {
    await refreshPayoutReadinessForOrder(orderId).catch((error) => {
      logger.error({ err: error, order_id: orderId }, "failed to refresh order payout readiness after sweep");
    });
  }

  return {
    ready_count: readyIds.length,
    order_count: touchedOrderIds.size,
  };
}

module.exports = {
  sweepVendorPayoutReadiness,
};
