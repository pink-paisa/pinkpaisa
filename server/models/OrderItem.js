const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    order_id: { type: String, required: true, index: true },
    product_id: { type: String, default: null },
    product_title: { type: String, required: true },
    price: { type: Number, required: true },
    cost_price: { type: Number, default: 0 },
    quantity: { type: Number, required: true, default: 1 },
    vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null, index: true },
    vendor_product_id: { type: mongoose.Schema.Types.ObjectId, ref: "VendorProduct", default: null },
    vendor_status: { type: String, enum: ["new", "accepted", "rejected", "pickup_assigned", "picked_up", "shipped", "out_for_delivery", "delivered", "return_requested", "out_for_return_pickup", "return_pickup_done", "in_transit_return", "return_in_transit", "returned", "refunded"], default: "new" },
    returnable: { type: Boolean, default: true },
    return_window_days: { type: Number, default: 7, min: 0 },
    return_liability: { type: String, enum: ["vendor", "pinkpaisa"], default: "vendor" },
    return_status: { type: String, enum: ["not_requested", "requested", "approved", "in_transit", "returned", "refunded", "rejected"], default: "not_requested" },
    return_reason: { type: String, default: null },
    return_requested_at: { type: Date, default: null },
    refund_status: { type: String, enum: ["none", "initiated", "processed", "manual", "failed"], default: "none" },
    refund_id: { type: String, default: null },
    refund_initiated_at: { type: Date, default: null },
    delivered_at: { type: Date, default: null },
    payout_status: { type: String, enum: ["on_hold", "ready", "released", "blocked"], default: "on_hold" },
    payout_amount: { type: Number, default: 0 },
    commission_percent: { type: Number, default: 20 },
    commission_amount: { type: Number, default: 0 },
    payout_released_at: { type: Date, default: null },
    payout_settlement_id: { type: mongoose.Schema.Types.ObjectId, ref: "VendorSettlement", default: null, index: true },
  },
  { timestamps: true }
);

OrderItemSchema.index({ vendor_id: 1, vendor_status: 1, payout_status: 1 });
OrderItemSchema.index({ vendor_id: 1, createdAt: -1 });
OrderItemSchema.index({ vendor_id: 1, vendor_status: 1, createdAt: -1 });

OrderItemSchema.pre("save", async function lockPayoutSnapshot(next) {
  if (this.isNew) return next();
  if (this.$locals?.allowPayoutSnapshotOverride) return next();

  const snapshotFields = ["commission_percent", "commission_amount", "payout_amount"];
  const touchedSnapshot = snapshotFields.some((field) => this.isModified(field));
  if (!touchedSnapshot) return next();

  const existing = await this.constructor
    .findById(this._id)
    .select("payout_status commission_percent commission_amount payout_amount")
    .lean();

  if (!existing) return next();

  if (String(existing.payout_status || "on_hold") !== "on_hold") {
    return next(new Error("Commission and payout snapshot fields are immutable after payout readiness begins."));
  }

  next();
});

module.exports = mongoose.model("OrderItem", OrderItemSchema);
