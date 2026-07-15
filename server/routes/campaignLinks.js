const express = require("express");
const { redirectMarketingCampaignLinkController } = require("../controllers/marketingCampaignController");

const router = express.Router();

router.get("/:campaignId", redirectMarketingCampaignLinkController);

module.exports = router;
