const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { listDeliveryPartners, createDeliveryPartner, updateDeliveryPartner } = require("../controllers/deliveryPartnerController");

router.get('/', protect, adminOnly, listDeliveryPartners);
router.post('/', protect, adminOnly, createDeliveryPartner);
router.put('/:id', protect, adminOnly, updateDeliveryPartner);

module.exports = router;
