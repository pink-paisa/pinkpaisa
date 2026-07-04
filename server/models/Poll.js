const mongoose = require("mongoose");

const PollSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    category: { type: String, default: "trending" },
    image_emoji: { type: String, default: "📊" },
    yes_count: { type: Number, default: 0 },
    no_count: { type: Number, default: 0 },
    ends_at: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Poll", PollSchema);
