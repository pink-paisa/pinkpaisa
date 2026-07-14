const express = require("express");
const router = express.Router();
const { recordAffiliateEvent, redirectAffiliateOutbound } = require("../controllers/affiliateEventController");

router.post("/", recordAffiliateEvent);
router.get("/out/:product", redirectAffiliateOutbound);

module.exports = router;
