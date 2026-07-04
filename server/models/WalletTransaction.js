const mongoose = require("mongoose");

const WalletTransactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["credit", "debit"], required: true },
  amount: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ["topup", "order_payment", "refund", "adjustment"], default: "topup" },
  note: { type: String, default: null },
  balance_after: { type: Number, required: true, min: 0 },
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
}, { timestamps: true });

module.exports = mongoose.model("WalletTransaction", WalletTransactionSchema);
