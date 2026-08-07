const mongoose = require("mongoose");

const PollVoteSchema = new mongoose.Schema(
  {
    poll_id: { type: String, required: true, index: true },
    user_id: { type: String, default: null, index: true },
    voter_fingerprint: { type: String, default: null },
    ip_address_hash: { type: String, default: null },
    vote: { type: String, enum: ["yes", "no"], required: true },
    vote_source: { type: String, enum: ["organic", "beta_launch"], default: "organic", index: true },
    campaign: { type: String, default: null, trim: true, maxlength: 80, index: true },
  },
  { timestamps: true }
);

PollVoteSchema.index({ poll_id: 1, user_id: 1 }, { unique: true, sparse: true });
PollVoteSchema.index({ poll_id: 1, voter_fingerprint: 1 }, { unique: true, sparse: true });
PollVoteSchema.index({ poll_id: 1, vote_source: 1, createdAt: -1 });

module.exports = mongoose.model("PollVote", PollVoteSchema);
