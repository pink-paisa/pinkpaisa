const mongoose = require("mongoose");

// Mirrors Supabase `workshop_quote_requests` table
const QuoteRequestSchema = new mongoose.Schema(
  {
    user_id: { type: String, default: null },
    company_name: { type: String, required: true },
    contact_name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    team_size: { type: Number, default: null },
    goals: { type: String, default: null },
    preferred_format: { type: String, default: null },
    budget: { type: String, default: null },
    internal_notes: { type: String, default: null },
    status: { type: String, enum: ["new", "contacted", "proposal_sent", "converted", "lost", "closed"], default: "new" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("QuoteRequest", QuoteRequestSchema);
