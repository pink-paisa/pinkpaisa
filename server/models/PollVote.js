const mongoose = require("mongoose");

const PollVoteSchema = new mongoose.Schema(
  {
    poll_id: { type: String, required: true, index: true },
    user_id: { type: String, default: null, index: true },
    voter_fingerprint: { type: String, default: null },
    ip_address_hash: { type: String, default: null },
    vote: { type: String, enum: ["yes", "no"], required: true },
  },
  { timestamps: true }
);

PollVoteSchema.index({ poll_id: 1, user_id: 1 }, { unique: true, sparse: true });
PollVoteSchema.index({ poll_id: 1, voter_fingerprint: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("PollVote", PollVoteSchema);
