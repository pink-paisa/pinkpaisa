const express = require("express");
const router = express.Router();
const { recordAffiliateEvent } = require("../controllers/affiliateEventController");

router.post("/", recordAffiliateEvent);

module.exports = router;
