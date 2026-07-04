const mongoose = require("mongoose");

const VendorUploadLogSchema = new mongoose.Schema({
  vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
  file_name: { type: String, required: true },
  total_rows: { type: Number, default: 0 },
  success_rows: { type: Number, default: 0 },
  failed_rows: { type: Number, default: 0 },
  upload_status: { type: String, enum: ["completed", "partial", "failed"], default: "completed" },
  error_json: { type: mongoose.Schema.Types.Mixed, default: [] },
}, {
  timestamps: { createdAt: "created_at", updatedAt: false },
});

module.exports = mongoose.model("VendorUploadLog", VendorUploadLogSchema);
