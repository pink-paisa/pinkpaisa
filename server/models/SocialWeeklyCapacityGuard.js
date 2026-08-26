const mongoose = require("mongoose");

const SocialWeeklyCapacityGuardSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  week_start: {
    type: String,
    required: true,
    immutable: true,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  week_end: {
    type: String,
    required: true,
    immutable: true,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  timezone: {
    type: String,
    required: true,
    immutable: true,
    enum: ["Asia/Kolkata"],
    default: "Asia/Kolkata",
  },
  fence: { type: Number, required: true, default: 0, min: 0 },
  maximum_seen: { type: Number, required: true, default: 3, min: 1, max: 7 },
  last_draft_id: { type: String, default: null, trim: true, maxlength: 100 },
  last_scheduled_for: { type: Date, default: null },
}, {
  timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  strict: "throw",
});

module.exports = mongoose.models.SocialWeeklyCapacityGuard
  || mongoose.model("SocialWeeklyCapacityGuard", SocialWeeklyCapacityGuardSchema);
