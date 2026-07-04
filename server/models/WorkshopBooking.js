const mongoose = require("mongoose");

const BOOKING_STATUSES = [
  "draft",
  "confirmed",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "refunded",
  "failed",
  "pending_payment",
];

const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "refunded",
  "cancelled",
  "pending_payment",
];

const WorkshopBookingSchema = new mongoose.Schema(
  {
    user_id: { type: String, default: null },
    workshop_id: { type: String, default: null },
    session_id: { type: String, default: null },
    workshop_title: { type: String, required: true },
    full_name: { type: String, required: true },
    company_name: { type: String, default: null },
    contact_person: { type: String, default: null },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    organization_type: { type: String, default: null },
    team_size: { type: Number, default: 1 },
    preferred_date: { type: String, default: null },
    preferred_time: { type: String, default: null },
    city: { type: String, default: null },
    delivery_mode: { type: String, default: "Online" },
    venue_address: { type: String, default: null },
    notes: { type: String, default: null },
    recording_addon: { type: Boolean, default: false },
    certification_addon: { type: Boolean, default: false },
    subtotal: { type: Number, default: 0 },
    addons_total: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    payment_method: { type: String, enum: ["phonepe", "wallet", "manual"], default: "phonepe" },
    payment_status: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
    booking_status: { type: String, enum: BOOKING_STATUSES, default: "draft" },
    merchant_order_id: { type: String, default: null, unique: true, sparse: true, index: true },
    phonepe_transaction_id: { type: String, default: null },
    refunded_at: { type: Date, default: null },
    refund_reference: { type: String, default: null },
    cancelled_at: { type: Date, default: null },
    internal_notes: { type: String, default: null },
    certificate_url: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WorkshopBooking", WorkshopBookingSchema);
