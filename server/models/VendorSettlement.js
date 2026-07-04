const mongoose = require("mongoose");

const SettlementInvoiceSchema = new mongoose.Schema(
  {
    invoice_number: { type: String, default: null },
    generated_at: { type: Date, default: null },
    html: { type: String, default: null },
  },
  { _id: false },
);

const SettlementBankSnapshotSchema = new mongoose.Schema(
  {
    account_holder_name: { type: String, default: null },
    account_number: { type: String, default: null },
    ifsc_code: { type: String, default: null },
    bank_name: { type: String, default: null },
  },
  { _id: false },
);

const VendorSettlementSchema = new mongoose.Schema(
  {
    settlement_number: { type: String, unique: true, index: true },
    vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    period_start: { type: Date, default: null },
    period_end: { type: Date, default: null },
    order_item_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "OrderItem" }],
    line_count: { type: Number, default: 0, min: 0 },
    gross_amount: { type: Number, default: 0, min: 0 },
    commission_amount: { type: Number, default: 0, min: 0 },
    commission_gst_amount: { type: Number, default: 0, min: 0 },
    tds_amount: { type: Number, default: 0, min: 0 },
    chargeback_amount: { type: Number, default: 0, min: 0 },
    net_payable: { type: Number, default: 0 },
    bank_snapshot: { type: SettlementBankSnapshotSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ["draft", "initiated", "processing", "paid", "failed", "reversed"],
      default: "draft",
      index: true,
    },
    payout_provider: {
      type: String,
      enum: ["manual", "razorpayx", "cashfree"],
      default: "manual",
    },
    payout_reference: { type: String, default: null },
    utr_number: { type: String, default: null },
    initiated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    initiated_at: { type: Date, default: null },
    processed_at: { type: Date, default: null },
    failed_reason: { type: String, default: null },
    reversed_at: { type: Date, default: null },
    invoice: { type: SettlementInvoiceSchema, default: () => ({}) },
    notes: { type: String, default: null },
  },
  { timestamps: true },
);

VendorSettlementSchema.index({ vendor_id: 1, status: 1 });
VendorSettlementSchema.index({ period_start: 1 });

function buildSettlementNumber(doc) {
  const date = new Date();
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const tail = String(doc?._id || new mongoose.Types.ObjectId())
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
  return `SET-${yyyymmdd}-${tail}`;
}

VendorSettlementSchema.pre("validate", function settlementNumber(next) {
  if (!this.settlement_number) {
    this.settlement_number = buildSettlementNumber(this);
  }
  next();
});

VendorSettlementSchema.pre("save", async function immutablePaidSettlement(next) {
  if (this.isNew) return next();

  const existing = await this.constructor.findById(this._id).select("status").lean();
  if (existing?.status === "paid") {
    return next(new Error("Paid settlements are immutable. Create a new adjustment or reversal instead."));
  }

  next();
});

module.exports = mongoose.model("VendorSettlement", VendorSettlementSchema);
