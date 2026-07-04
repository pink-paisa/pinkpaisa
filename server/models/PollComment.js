const mongoose = require("mongoose");

const PollCommentSchema = new mongoose.Schema(
  {
    poll_id: { type: String, required: true, index: true },
    user_id: { type: String, default: null, index: true },
    ip_address_hash: { type: String, default: null },
    author_name: { type: String, required: true, default: "Anonymous" },
    content: { type: String, required: true },
    status: { type: String, enum: ["visible", "hidden", "flagged"], default: "visible", index: true },
    moderation_note: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PollComment", PollCommentSchema);
