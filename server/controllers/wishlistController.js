const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");

const serializeProduct = (product) => ({ ...product, id: product._id.toString() });

const getWishlist = async (req, res) => {
  try {
    const items = await Wishlist.find({ user_id: req.user._id }).populate('product_id').sort({ createdAt: -1 }).lean();
    res.json(items.filter((item) => item.product_id).map((item) => ({ id: item._id.toString(), created_at: item.createdAt, product: serializeProduct(item.product_id) })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const addWishlistItem = async (req, res) => {
  try {
    const product = await Product.findById(req.body.product_id).lean();
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const existing = await Wishlist.findOne({ user_id: req.user._id, product_id: req.body.product_id }).lean();
    if (!existing) {
      const count = await Wishlist.countDocuments({ user_id: req.user._id });
      if (count >= 200) {
        return res.status(400).json({ message: 'Wishlist limit reached. Please remove an item before adding more.' });
      }
    }
    const item = await Wishlist.findOneAndUpdate(
      { user_id: req.user._id, product_id: req.body.product_id },
      { user_id: req.user._id, product_id: req.body.product_id },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ id: item._id.toString(), product_id: req.body.product_id });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const removeWishlistItem = async (req, res) => {
  try {
    await Wishlist.findOneAndDelete({ user_id: req.user._id, product_id: req.params.productId });
    res.json({ message: 'Removed from wishlist' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getWishlist, addWishlistItem, removeWishlistItem };
