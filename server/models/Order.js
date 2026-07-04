const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    order_number: {
      type: String,
      unique: true,
      index: true,
    },

    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    guest_name: { type: String, required: true },
    guest_email: { type: String, required: true },
    guest_phone: { type: String, default: null },
    shipping_address: { type: String, default: null },
    shipping_city: { type: String, default: null },
    shipping_state: { type: String, default: null },
    shipping_pincode: { type: String, default: null },
    subtotal: { type: Number, required: true },
    shipping_cost: { type: Number, default: 0 },
    total: { type: Number, required: true },
    payment_method: { type: String, enum: ["wallet", "phonepe", "cod"], default: "phonepe" },
    wallet_used: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "confirmed", "processing", "pickup_assigned", "picked_up", "shipped", "delivered", "return_requested", "return_in_transit", "returned", "refunded", "cancelled"],
      default: "pending",
    },
    delivery_status: {
      type: String,
      enum: ["pending", "pickup_assigned", "picked_up", "shipped", "delivered", "return_requested", "return_in_transit", "returned"],
      default: "pending",
    },
    payment_status: { type: String, enum: ["pending", "paid", "failed", "hold", "released_to_vendor", "partially_refunded", "refunded"], default: "pending" },
    delivery_partner_id: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner", default: null },
    delivery_partner_name: { type: String, default: null },
    pickup_address: { type: String, default: null },
    pickup_city: { type: String, default: null },
    pickup_state: { type: String, default: null },
    pickup_pincode: { type: String, default: null },
    phonepe_order_id: { type: String, default: null },
    phonepe_transaction_id: { type: String, default: null },
    delivered_at: { type: Date, default: null },
    invoice_number: { type: String, default: null, index: true },
    invoice_generated_at: { type: Date, default: null },
    payout_hold_until: { type: Date, default: null },
    vendor_payout_status: { type: String, enum: ["not_ready", "on_hold", "ready", "released", "blocked"], default: "not_ready" },
    vendor_payout_amount: { type: Number, default: 0 },
    pinkpaisa_commission_amount: { type: Number, default: 0 },
    refunded_amount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

OrderSchema.pre("validate", function (next) {
  if (!this.order_number) {
    const ts = Date.now().toString().slice(-8);
    const rand = Math.floor(1000 + Math.random() * 9000);
    this.order_number = `PP${ts}${rand}`;
  }
  next();
});

OrderSchema.index({ phonepe_order_id: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Order", OrderSchema);
