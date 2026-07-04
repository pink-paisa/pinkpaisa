const mongoose = require("mongoose");

const AmazonReportRowSchema = new mongoose.Schema({
  report_source: { type: String, default: "amazon_associates_csv", index: true },
  report_date: { type: Date, default: null, index: true },
  marketplace: { type: String, enum: ["amazon_in", "amazon_us", null], default: null, index: true },
  asin: { type: String, default: null, trim: true, uppercase: true, index: true },
  tracking_id: { type: String, default: null, trim: true, index: true },
  campaign_label: { type: String, default: null, trim: true, index: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },
  title: { type: String, default: null, trim: true },
  ordered_items: { type: Number, default: 0, min: 0 },
  shipped_items: { type: Number, default: 0, min: 0 },
  returned_items: { type: Number, default: 0, min: 0 },
  revenue: { type: Number, default: 0 },
  commission: { type: Number, default: 0 },
  currency: { type: String, default: null, trim: true },
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  import_batch_id: { type: String, required: true, index: true },
  source_file_hash: { type: String, required: true, index: true },
  source_row_number: { type: Number, required: true, min: 1 },
  row_hash: { type: String, required: true, index: true },
}, { timestamps: true });

AmazonReportRowSchema.index({ marketplace: 1, asin: 1, report_date: 1 });
AmazonReportRowSchema.index({ product_id: 1, report_date: 1 });
AmazonReportRowSchema.index(
  { source_file_hash: 1, source_row_number: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source_file_hash: { $type: "string" },
      source_row_number: { $type: "number" },
    },
  }
);

module.exports = mongoose.model("AmazonReportRow", AmazonReportRowSchema);
