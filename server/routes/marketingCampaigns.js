const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  createMarketingCampaignFromApprovedProduct,
  createMarketingCampaignFromProductSource,
  getMarketingBatchDetail,
  getMarketingCampaignCalendar,
  getLatestMarketingBatch,
  getMarketingCampaignRun,
  listMarketingCampaignCatalogProducts,
  listMarketingCampaignRuns,
  publishMarketingCarouselController,
  publishMarketingCampaignController,
  recoverStaleMarketingTasksController,
  regenerateMarketingCampaign,
  resetStuckMarketingCampaignController,
  reviewMarketingCampaignRun,
  retryFailedMarketingBatchItems,
  retryMarketingCampaign,
  runDailyMarketingBatchController,
  scanMarketingCampaignReadiness,
  scheduleMarketingCampaignController,
  updateMarketingCampaignDraftController,
} = require("../controllers/marketingCampaignController");

router.get("/admin", protect, adminOnly, listMarketingCampaignRuns);
router.get("/admin/batches/latest", protect, adminOnly, getLatestMarketingBatch);
router.get("/admin/batches/:id", protect, adminOnly, getMarketingBatchDetail);
router.post("/admin/batches/:id/retry-failed", protect, adminOnly, retryFailedMarketingBatchItems);
router.get("/admin/calendar", protect, adminOnly, getMarketingCampaignCalendar);
router.get("/admin/catalog-products", protect, adminOnly, listMarketingCampaignCatalogProducts);
router.post("/admin/readiness-scan", protect, adminOnly, scanMarketingCampaignReadiness);
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
