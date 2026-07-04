const express = require("express");
const router = express.Router();
const { protectVendor } = require("../middleware/vendorAuth");
const { listVendorOrders, getVendorOrderSummary, getVendorPayoutLedger, updateVendorOrderStatus } = require("../controllers/vendorOrderController");

router.get("/mine/summary", protectVendor, getVendorOrderSummary);
router.get("/mine/ledger", protectVendor, getVendorPayoutLedger);
router.get("/mine", protectVendor, listVendorOrders);
router.put("/mine/:itemId/status", protectVendor, updateVendorOrderStatus);

module.exports = router;
