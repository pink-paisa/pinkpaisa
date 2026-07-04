const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");

const getWalletSummary = async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ user_id: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
    const user = await User.findById(req.user._id).lean();
    res.json({
      balance: Number(user?.wallet_balance || 0),
      transactions: transactions.map((txn) => ({ ...txn, id: txn._id.toString() })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const addMoney = async (req, res) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Enter a valid amount' });
    const targetUserId = String(req.body.user_id || req.user._id || "").trim();
    const user = await User.findById(targetUserId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.wallet_balance = Number(user.wallet_balance || 0) + amount;
    await user.save();
    const transaction = await WalletTransaction.create({
      user_id: user._id,
      type: 'credit',
      amount,
      source: 'topup',
      note: req.body.note || 'Admin wallet credit',
      balance_after: user.wallet_balance,
    });
    res.status(201).json({ balance: user.wallet_balance, transaction: { ...transaction.toObject(), id: transaction._id.toString() } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = { getWalletSummary, addMoney };
