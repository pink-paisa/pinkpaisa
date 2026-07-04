const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  listUsers,
  getUserDetails,
  creditUserWallet,
  lockUserAccount,
  unlockUserAccount,
  resendUserVerification,
} = require("../controllers/userController");

router.get('/', protect, adminOnly, listUsers);
router.get('/:id', protect, adminOnly, getUserDetails);
router.post('/:id/wallet-credit', protect, adminOnly, creditUserWallet);
router.post('/:id/lock', protect, adminOnly, lockUserAccount);
router.post('/:id/unlock', protect, adminOnly, unlockUserAccount);
router.post('/:id/resend-verification', protect, adminOnly, resendUserVerification);

module.exports = router;
