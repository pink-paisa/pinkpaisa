const mongoose = require("mongoose");

const SchedulerLeaseSchema = new mongoose.Schema({
  lease_key: { type: String, required: true, unique: true, trim: true },
  lease_owner: { type: String, required: true, trim: true },
  lease_expires_at: { type: Date, required: true, index: true },
  heartbeat_at: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model("SchedulerLease", SchedulerLeaseSchema);
