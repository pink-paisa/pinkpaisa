const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getProfile,
  updateProfile,
  getMyOrders,
  getCartSnapshot,
  updateCartSnapshot,
} = require("../controllers/accountController");
const {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} = require("../controllers/addressController");

router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.get('/orders', protect, getMyOrders);
router.get('/cart', protect, getCartSnapshot);
router.put('/cart', protect, updateCartSnapshot);
router.get('/addresses', protect, listAddresses);
router.post('/addresses', protect, createAddress);
router.put('/addresses/:id', protect, updateAddress);
router.delete('/addresses/:id', protect, deleteAddress);
router.post('/addresses/:id/set-default', protect, setDefaultAddress);

module.exports = router;
