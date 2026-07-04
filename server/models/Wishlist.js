const mongoose = require("mongoose");

const WishlistSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
}, { timestamps: true });

WishlistSchema.index({ user_id: 1, product_id: 1 }, { unique: true });

module.exports = mongoose.model("Wishlist", WishlistSchema);
