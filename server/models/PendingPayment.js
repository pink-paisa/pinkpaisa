const mongoose = require("mongoose");

/**
 * Temporary store for payment intents.
 * Created when the user clicks "Pay with PhonePe".
 * Converted to a real Order + OrderItems only after payment is verified as COMPLETED.
 * Entries that are never completed can be cleaned up periodically.
 */
const PendingPaymentSchema = new mongoose.Schema(
  {
    merchant_order_id: { type: String, required: true, unique: true, index: true },
    purpose: {
      type: String,
      enum: ["order", "wallet_topup", "workshop_booking"],
      default: "order",
      index: true,
    },
    reference_id: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
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
    cart_items: { type: mongoose.Schema.Types.Mixed, required: true }, // raw cart items array
    reserved_items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ["initiated", "pending", "processing", "completed", "failed", "expired"], default: "initiated", index: true },
    processing_started_at: { type: Date, default: null },
    expires_at: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) }, // 30 min TTL
  },
  { timestamps: true }
);

PendingPaymentSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PendingPayment", PendingPaymentSchema);
