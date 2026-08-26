const express = require("express");
const { createRateLimiter } = require("../middleware/requestGuards");
const { requireCaptcha } = require("../middleware/captcha");
const { createMarketingLead, unsubscribe } = require("../controllers/marketingLeadController");

const router = express.Router();
const leadLimiter = createRateLimiter({
  keyPrefix: "marketing-lead",
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many roadmap requests. Please wait before trying again.",
});

router.post("/leads", leadLimiter, requireCaptcha({ skipWhenAuthenticated: false, action: "wealthness_lead" }), createMarketingLead);
router.post("/unsubscribe", leadLimiter, unsubscribe);

module.exports = router;
