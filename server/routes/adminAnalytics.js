const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { getAdminAnalytics } = require("../controllers/adminAnalyticsController");

router.get("/", protect, adminOnly, getAdminAnalytics);

module.exports = router;
