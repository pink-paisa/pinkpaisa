const express = require("express");
const { protect, adminOnly } = require("../middleware/auth");
const {
  exportMarketingLeadsCsv,
  listMarketingLeads,
  updateMarketingLead,
} = require("../controllers/marketingLeadController");

const router = express.Router();

router.use(protect, adminOnly);
router.get("/export.csv", exportMarketingLeadsCsv);
router.get("/", listMarketingLeads);
router.patch("/:id", updateMarketingLead);

module.exports = router;
