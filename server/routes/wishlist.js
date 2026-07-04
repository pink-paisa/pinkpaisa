const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getWishlist, addWishlistItem, removeWishlistItem } = require("../controllers/wishlistController");

router.get('/', protect, getWishlist);
router.post('/', protect, addWishlistItem);
router.delete('/:productId', protect, removeWishlistItem);

module.exports = router;
