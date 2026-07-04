const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  createMarketingCampaignFromApprovedProduct,
  createMarketingCampaignFromProductSource,
  getLatestMarketingBatch,
  getMarketingCampaignRun,
  listMarketingCampaignRuns,
  publishMarketingCarouselController,
  publishMarketingCampaignController,
  recoverStaleMarketingTasksController,
  regenerateMarketingCampaign,
  resetStuckMarketingCampaignController,
  reviewMarketingCampaignRun,
  retryMarketingCampaign,
  runDailyMarketingBatchController,
  scheduleMarketingCampaignController,
  updateMarketingCampaignDraftController,
} = require("../controllers/marketingCampaignController");

router.get("/admin", protect, adminOnly, listMarketingCampaignRuns);
router.get("/admin/batches/latest", protect, adminOnly, getLatestMarketingBatch);
router.post("/admin/run-daily-batch", protect, adminOnly, runDailyMarketingBatchController);
router.post("/admin/recover-stale-tasks", protect, adminOnly, recoverStaleMarketingTasksController);
router.post("/admin/post-carousel", protect, adminOnly, publishMarketingCarouselController);
router.post("/admin/from-product/:productId", protect, adminOnly, createMarketingCampaignFromProductSource);
router.post("/admin/from-vendor-product/:vendorProductId", protect, adminOnly, createMarketingCampaignFromApprovedProduct);
router.get("/admin/:id", protect, adminOnly, getMarketingCampaignRun);
router.patch("/admin/:id/draft", protect, adminOnly, updateMarketingCampaignDraftController);
router.post("/admin/:id/review", protect, adminOnly, reviewMarketingCampaignRun);
router.post("/admin/:id/regenerate", protect, adminOnly, regenerateMarketingCampaign);
router.post("/admin/:id/post", protect, adminOnly, publishMarketingCampaignController);
router.post("/admin/:id/reset-stuck", protect, adminOnly, resetStuckMarketingCampaignController);
router.post("/admin/:id/schedule", protect, adminOnly, scheduleMarketingCampaignController);
router.post("/admin/:id/retry", protect, adminOnly, retryMarketingCampaign);

module.exports = router;
