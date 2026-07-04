const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { protectVendor } = require("../middleware/vendorAuth");
const {
  listSettlements,
  getSettlement,
  downloadSettlementInvoice,
  listVendorSettlements,
  getVendorSettlement,
  markSettlementPaidManual,
} = require("../controllers/settlementController");

router.get("/mine", protectVendor, listVendorSettlements);
router.get("/mine/:id", protectVendor, getVendorSettlement);
router.get("/mine/:id/invoice", protectVendor, downloadSettlementInvoice);

router.get("/", protect, adminOnly, listSettlements);
router.get("/:id", protect, adminOnly, getSettlement);
router.post("/:id/mark-paid", protect, adminOnly, markSettlementPaidManual);
router.get("/:id/invoice", protect, adminOnly, downloadSettlementInvoice);

module.exports = router;
