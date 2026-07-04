const mongoose = require("mongoose");

const WorkshopSessionSchema = new mongoose.Schema(
  {
    workshop_id: { type: String, default: null },
    title: { type: String, required: true },
    session_date: { type: Date, default: null },
    session_time: { type: String, default: null },
    duration: { type: String, default: null },
    trainer: { type: String, default: null },
    delivery_mode: { type: String, default: "Online" },
    venue_or_link: { type: String, default: null },
    meeting_link: { type: String, default: null },
    recording_link: { type: String, default: null },
    max_participants: { type: Number, default: 50 },
    total_participants: { type: Number, default: 0 },
    booking_ids: { type: [String], default: [] },
    status: { type: String, enum: ["planned", "confirmed", "in_progress", "completed", "cancelled", "rescheduled"], default: "planned" },
    internal_notes: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WorkshopSession", WorkshopSessionSchema);
