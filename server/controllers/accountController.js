const User = require("../models/User");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");

const serializeUser = (user) => ({
  id: user._id?.toString?.() || user.id,
  email: user.email,
  role: user.role,
  email_verified: Boolean(user.email_verified),
  full_name: user.full_name,
  phone: user.phone,
  address: user.address,
  city: user.city,
  state: user.state,
  pincode: user.pincode,
  wallet_balance: Number(user.wallet_balance || 0),
  created_at: user.createdAt || user.created_at,
  updated_at: user.updatedAt || user.updated_at,
});

const sanitizeCartSnapshotItem = (item = {}) => {
  if (!item || typeof item !== "object") return null;

  const id = String(item.id ?? "").trim();
  const title = String(item.title ?? "").trim();
  const price = Number(item.price);
  const quantity = Number(item.quantity);

  if (!id || !title || !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity < 1) {
    return null;
  }

  const priceMaxRaw = item.priceMax ?? item.price_max ?? price;
  const priceMax = Number.isFinite(Number(priceMaxRaw)) ? Number(priceMaxRaw) : price;
  const stockAtAddRaw = item.stock_quantity_at_add ?? item.stock_quantity ?? null;
  const stockQuantityAtAdd = stockAtAddRaw == null || stockAtAddRaw === ""
    ? null
    : (Number.isFinite(Number(stockAtAddRaw)) ? Math.max(Number(stockAtAddRaw), 0) : null);

  return {
    id,
    title,
    price,
    priceMax,
    quantity: Math.min(Math.max(Math.round(quantity), 1), 99),
    format: String(item.format ?? "").trim() || null,
    image_url: String(item.image_url ?? "").trim() || null,
    slug: String(item.slug ?? "").trim() || null,
    stock_quantity_at_add: stockQuantityAtAdd,
  };
};

const getCartSnapshot = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("cart_snapshot_json").lean();
    const items = Array.isArray(user?.cart_snapshot_json)
      ? user.cart_snapshot_json.map(sanitizeCartSnapshotItem).filter(Boolean)
      : [];
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateCartSnapshot = async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    const items = rawItems.map(sanitizeCartSnapshotItem).filter(Boolean).slice(0, 100);
    await User.findByIdAndUpdate(req.user._id, { cart_snapshot_json: items });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const getProfile = async (req, res) => {
  res.json(serializeUser(req.user));
};

const updateProfile = async (req, res) => {
  try {
    const updates = {
      full_name: req.body.full_name,
      phone: req.body.phone,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      pincode: req.body.pincode,
    };
    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).lean();
    res.json(serializeUser(user));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user_id: req.user._id }).sort({ createdAt: -1 }).lean();
    const orderIds = orders.map((order) => order._id.toString());
    const items = await OrderItem.find({ order_id: { $in: orderIds } }).lean();
    const itemMap = {};
    for (const item of items) {
      if (!itemMap[item.order_id]) itemMap[item.order_id] = [];
      itemMap[item.order_id].push({ ...item, id: item._id.toString() });
    }
    res.json(orders.map((order) => ({ ...order, id: order._id.toString(), items: itemMap[order._id.toString()] || [] })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getMyOrders,
  getCartSnapshot,
  updateCartSnapshot,
  serializeUser,
};
