const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Vendor = require("../models/Vendor");
const { syncOrderFromItems } = require("./orderController");

const VENDOR_ITEM_STATUS_FLOW = {
  new: ["rejected"],
  accepted: ["rejected"],
  pickup_assigned: ["picked_up", "rejected"],
  picked_up: [],
  shipped: [],
  delivered: [],
  return_requested: [],
  return_in_transit: [],
  returned: [],
  refunded: [],
  rejected: [],
};

function canVendorMove(from, to) {
  if (!to || from === to) return true;
  return (VENDOR_ITEM_STATUS_FLOW[from] || []).includes(to);
}

function serializeVendorOrderItem(item, order) {
  if (!order) return null;
  return {
    id: item._id.toString(),
    order_id: order._id.toString(),
    order_number: order.order_number,
    invoice_number: order.invoice_number || null,
    product_title: item.product_title,
    price: item.price,
    quantity: item.quantity,
    vendor_status: item.vendor_status,
    return_status: item.return_status,
    returnable: item.returnable,
    return_window_days: item.return_window_days,
    payout_status: item.payout_status,
    payout_amount: item.payout_amount,
    gross_amount: Number(item.price || 0) * Number(item.quantity || 0),
    commission_percent: item.commission_percent,
    commission_amount: item.commission_amount,
    order_status: order.status,
    delivery_status: order.delivery_status,
    created_at: item.createdAt || item.created_at,
    delivered_at: item.delivered_at || order.delivered_at || null,
    payout_released_at: item.payout_released_at || null,
  };
}

async function getVendorBalanceSummary(vendorId) {
  const items = await OrderItem.find({ vendor_id: vendorId }).lean();
  const summary = {
    total_payout_amount: 0,
    hold_amount: 0,
    ready_amount: 0,
    received_amount: 0,
    blocked_amount: 0,
    order_count: items.length,
  };

  for (const item of items) {
    const value = Number(item.payout_amount || 0);
    summary.total_payout_amount += value;
    if (item.payout_status === "on_hold") summary.hold_amount += value;
    else if (item.payout_status === "ready") summary.ready_amount += value;
    else if (item.payout_status === "released") summary.received_amount += value;
    else if (item.payout_status === "blocked") summary.blocked_amount += value;
  }

  return summary;
}

const listVendorOrders = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const status = String(req.query.status || "all");
    const query = { vendor_id: vendorId };
    if (status !== "all") query.vendor_status = status;
    const items = await OrderItem.find(query).sort({ createdAt: -1 }).lean();
    const orderIds = [...new Set(items.map((item) => item.order_id))];
    const orders = await Order.find({ _id: { $in: orderIds } }).lean();
    const orderMap = new Map(orders.map((order) => [order._id.toString(), order]));
    const summary = await getVendorBalanceSummary(vendorId);
    res.json({ items: items.map((item) => serializeVendorOrderItem(item, orderMap.get(item.order_id))).filter(Boolean), summary });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getVendorOrderSummary = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const summary = await getVendorBalanceSummary(vendorId);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getVendorPayoutLedger = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const items = await OrderItem.find({ vendor_id: vendorId }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    const orderIds = [...new Set(items.map((item) => item.order_id))];
    const orders = await Order.find({ _id: { $in: orderIds } }).lean();
    const orderMap = new Map(orders.map((order) => [order._id.toString(), order]));
    const ledger = items
      .map((item) => serializeVendorOrderItem(item, orderMap.get(item.order_id)))
      .filter(Boolean)
      .map((entry) => ({
        ...entry,
        settlement_stage:
          entry.payout_status === "released"
            ? "settled"
            : entry.payout_status === "ready"
              ? "ready_for_release"
              : entry.payout_status === "on_hold"
                ? "in_hold_window"
                : "blocked",
      }));
    res.json({ items: ledger });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateVendorOrderStatus = async (req, res) => {
  try {
    const vendorId = req.vendor._id || req.vendor.id;
    const { vendor_status } = req.body;
    const item = await OrderItem.findOne({ _id: req.params.itemId, vendor_id: vendorId });
    if (!item) return res.status(404).json({ message: "Vendor order item not found" });
    if (!canVendorMove(item.vendor_status, vendor_status)) return res.status(400).json({ message: `Invalid status transition from ${item.vendor_status} to ${vendor_status}` });
    item.vendor_status = vendor_status;
    if (vendor_status === "rejected") {
      item.payout_status = "blocked";
      const vendor = await Vendor.findById(vendorId);
      if (vendor) {
        vendor.order_reject_count = Number(vendor.order_reject_count || 0) + 1;
        if (vendor.order_reject_count >= Number(vendor.auto_ban_threshold || 5)) vendor.status = "banned";
        await vendor.save();
      }
    }
    if (vendor_status === "picked_up") {
      const order = await Order.findById(item.order_id);
      if (order) {
        order.status = "picked_up";
        order.delivery_status = "picked_up";
        await order.save();
      }
    }
    await item.save();
    await syncOrderFromItems(item.order_id);
    res.json({ message: "Vendor order status updated" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = { listVendorOrders, getVendorOrderSummary, getVendorPayoutLedger, updateVendorOrderStatus, VENDOR_ITEM_STATUS_FLOW };
