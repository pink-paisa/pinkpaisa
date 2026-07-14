const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");

const APPROVED_AFFILIATE_DATA_SOURCES = new Set(["creators_api", "pa_api"]);

const canShowAffiliatePrice = (product = {}) => {
  if (!product.is_affiliate) return true;
  if (!APPROVED_AFFILIATE_DATA_SOURCES.has(String(product.affiliate_data_source || ""))) return false;
  if (!product.affiliate_data_expires_at) return false;
  const expiresAt = new Date(product.affiliate_data_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
};

const serializeProduct = (product) => {
  const showAffiliatePrice = canShowAffiliatePrice(product);
  return {
    id: product._id.toString(),
    slug: product.slug,
    title: product.title,
    featured_image: product.featured_image || null,
    price: product.is_affiliate && !showAffiliatePrice ? 0 : Number(product.price || 0),
    sale_price: product.is_affiliate && !showAffiliatePrice ? null : product.sale_price ?? null,
    stock_quantity: product.is_affiliate ? 0 : Number(product.stock_quantity || 0),
    is_affiliate: Boolean(product.is_affiliate),
    affiliate_url: product.affiliate_url || null,
    affiliate_data_source: product.affiliate_data_source || null,
    affiliate_data_last_refreshed_at: product.affiliate_data_last_refreshed_at || null,
    affiliate_data_expires_at: product.affiliate_data_expires_at || null,
    affiliate_compliance_status: product.affiliate_compliance_status || null,
  };
};

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

module.exports = {
  getWishlist,
  addWishlistItem,
  removeWishlistItem,
  _private: {
    serializeProduct,
  },
};
