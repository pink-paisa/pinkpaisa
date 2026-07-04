const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { getWalletSummary, addMoney } = require("../controllers/walletController");

router.get('/', protect, getWalletSummary);
router.post('/add-money', protect, adminOnly, addMoney);

module.exports = router;
