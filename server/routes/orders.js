const express = require("express");
const router = express.Router();
const { getOrders, getOrder, getOrderReceipt, getOrderItems, createOrder, cancelOrder, updateOrder, assignDeliveryPartner, requestReturn, processReturnRefund, downloadOrderInvoice, getVendorOutstanding, releaseVendorPayments, updateShipmentStatus } = require("../controllers/orderController");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");

router.get("/vendor-outstanding", protect, adminOnly, getVendorOutstanding);
router.post("/vendor-outstanding/release-payment", protect, adminOnly, releaseVendorPayments);
router.get("/", protect, getOrders);
router.get("/:id/items", protect, getOrderItems);
router.get("/:id/invoice", protect, downloadOrderInvoice);
router.get("/:id/receipt", optionalProtect, getOrderReceipt);
router.get("/:id", protect, getOrder);
router.post("/", optionalProtect, createOrder);
router.post("/:id/cancel", protect, cancelOrder);
router.post("/request-return", protect, requestReturn);
router.post("/process-refund", protect, adminOnly, processReturnRefund);
router.put("/:id", protect, adminOnly, updateOrder);
router.put("/:id/assign-delivery", protect, adminOnly, assignDeliveryPartner);
router.put("/:id/shipment-status", protect, adminOnly, updateShipmentStatus);

module.exports = router;
