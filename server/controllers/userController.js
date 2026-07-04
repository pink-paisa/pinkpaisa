const User = require("../models/User");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const WalletTransaction = require("../models/WalletTransaction");
const { createSecureToken } = require("../utils/tokens");
const { sendCustomerVerificationEmail } = require("../utils/email");

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const serializeUser = (user, meta = {}) => ({
  id: user._id?.toString?.() || user.id,
  email: user.email,
  role: user.role,
  full_name: user.full_name,
  phone: user.phone,
  address: user.address,
  city: user.city,
  state: user.state,
  pincode: user.pincode,
  email_verified: Boolean(user.email_verified),
  locked_until: user.locked_until || null,
  last_login_at: user.last_login_at || null,
  wallet_balance: Number(user.wallet_balance || 0),
  created_at: user.createdAt || user.created_at,
  updated_at: user.updatedAt || user.updated_at,
  meta,
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function parsePagination(query) {
  const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
  const limit = clamp(parseInt(query.limit || "15", 10) || 15, 1, 100);
  return { page, limit };
}

const listUsers = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const { page, limit } = parsePagination(req.query);
    const query = { role: 'user' };
    if (search) {
      query.$or = [
        { full_name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const userIds = users.map((user) => user._id);
    const orderStats = await Order.aggregate([
      { $match: { user_id: { $in: userIds } } },
      { $group: { _id: '$user_id', order_count: { $sum: 1 }, total_spent: { $sum: '$total' } } },
    ]);
    const statMap = Object.fromEntries(orderStats.map((row) => [String(row._id), row]));
    res.json({
      items: users.map((user) => serializeUser(user, {
        order_count: statMap[String(user._id)]?.order_count || 0,
        total_spent: statMap[String(user._id)]?.total_spent || 0,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: 'user' }).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    const orders = await Order.find({ user_id: user._id }).sort({ createdAt: -1 }).lean();
    const orderIds = orders.map((order) => order._id.toString());
    const items = await OrderItem.find({ order_id: { $in: orderIds } }).lean();
    const walletTransactions = await WalletTransaction.find({ user_id: user._id }).sort({ createdAt: -1 }).limit(10).lean();
    const itemMap = {};
    for (const item of items) {
      if (!itemMap[item.order_id]) itemMap[item.order_id] = [];
      itemMap[item.order_id].push(item);
    }
    res.json({
      user: serializeUser(user),
      orders: orders.map((order) => ({ ...order, id: order._id.toString(), items: itemMap[order._id.toString()] || [] })),
      wallet_transactions: walletTransactions.map((txn) => ({ ...txn, id: txn._id.toString() })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const creditUserWallet = async (req, res) => {
  try {
    const amount = Number(req.body.amount || 0);
    const note = String(req.body.note || "").trim();
    if (!amount || amount <= 0) return res.status(400).json({ message: "Enter a valid amount" });
    if (!note) return res.status(400).json({ message: "A reason is required for wallet credit" });

    const user = await User.findOne({ _id: req.params.id, role: "user" });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.wallet_balance = Number(user.wallet_balance || 0) + amount;
    await user.save();

    const transaction = await WalletTransaction.create({
      user_id: user._id,
      type: "credit",
      amount,
      source: "adjustment",
      note,
      balance_after: user.wallet_balance,
    });

    res.status(201).json({
      balance: Number(user.wallet_balance || 0),
      transaction: { ...transaction.toObject(), id: transaction._id.toString() },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const lockUserAccount = async (req, res) => {
  try {
    const hours = clamp(parseInt(req.body.hours || "24", 10) || 24, 1, 24 * 30);
    const user = await User.findOne({ _id: req.params.id, role: "user" });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.locked_until = new Date(Date.now() + hours * 60 * 60 * 1000);
    await user.save();

    res.json({ locked_until: user.locked_until });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const unlockUserAccount = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: "user" });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.locked_until = null;
    user.failed_login_attempts = 0;
    await user.save();

    res.json({ message: "Account unlocked" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const resendUserVerification = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: "user" });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.email_verified) return res.status(400).json({ message: "User email is already verified" });

    const { raw, hash } = createSecureToken();
    user.email_verification_token = hash;
    user.email_verification_expires_at = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
    await user.save();

    const preview = await sendCustomerVerificationEmail({
      email: user.email,
      fullName: user.full_name,
      token: raw,
    });

    res.json({
      message: "Verification email sent",
      ...(process.env.NODE_ENV !== "production" ? preview : {}),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  listUsers,
  getUserDetails,
  creditUserWallet,
  lockUserAccount,
  unlockUserAccount,
  resendUserVerification,
};
