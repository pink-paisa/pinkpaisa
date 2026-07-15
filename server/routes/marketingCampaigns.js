const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  archiveMarketingCampaignController,
  bulkArchiveMarketingCampaignsController,
  bulkReviewMarketingCampaignsController,
  cancelMarketingCarouselController,
  createMarketingCampaignFromApprovedProduct,
  createMarketingCampaignFromProductSource,
  getMarketingBatchDetail,
  getMarketingCarouselController,
  getMarketingCampaignCalendar,
  getLatestMarketingBatch,
  getMarketingQueueHealthController,
  getMarketingCampaignRun,
  listMarketingCampaignCatalogProducts,
  listMarketingCampaignRuns,
  previewMarketingCarouselController,
  publishMarketingCarouselController,
  publishMarketingCampaignController,
  purgeMarketingCampaignController,
  recoverStaleMarketingTasksController,
  regenerateMarketingCampaign,
  resetStuckMarketingCampaignController,
  rescheduleMarketingCarouselController,
  reviewMarketingCampaignRun,
  restoreMarketingCampaignController,
  retryFailedMarketingBatchItems,
  retryMarketingCampaign,
  retryMarketingCarouselController,
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
router.get("/admin/queue-health", protect, adminOnly, getMarketingQueueHealthController);
router.post("/admin/readiness-scan", protect, adminOnly, scanMarketingCampaignReadiness);
router.post("/admin/run-daily-batch", protect, adminOnly, runDailyMarketingBatchController);
router.post("/admin/recover-stale-tasks", protect, adminOnly, recoverStaleMarketingTasksController);
router.post("/admin/carousels/preview", protect, adminOnly, previewMarketingCarouselController);
router.post("/admin/post-carousel", protect, adminOnly, publishMarketingCarouselController);
router.get("/admin/carousels/:taskId", protect, adminOnly, getMarketingCarouselController);
router.patch("/admin/carousels/:taskId/schedule", protect, adminOnly, rescheduleMarketingCarouselController);
router.post("/admin/carousels/:taskId/cancel", protect, adminOnly, cancelMarketingCarouselController);
router.post("/admin/carousels/:taskId/retry", protect, adminOnly, retryMarketingCarouselController);
router.post("/admin/bulk-archive", protect, adminOnly, bulkArchiveMarketingCampaignsController);
router.post("/admin/bulk-review", protect, adminOnly, bulkReviewMarketingCampaignsController);
router.post("/admin/from-product/:productId", protect, adminOnly, createMarketingCampaignFromProductSource);
router.post("/admin/from-vendor-product/:vendorProductId", protect, adminOnly, createMarketingCampaignFromApprovedProduct);
router.get("/admin/:id", protect, adminOnly, getMarketingCampaignRun);
router.patch("/admin/:id/draft", protect, adminOnly, updateMarketingCampaignDraftController);
router.post("/admin/:id/review", protect, adminOnly, reviewMarketingCampaignRun);
router.post("/admin/:id/regenerate", protect, adminOnly, regenerateMarketingCampaign);
router.post("/admin/:id/post", protect, adminOnly, publishMarketingCampaignController);
router.post("/admin/:id/archive", protect, adminOnly, archiveMarketingCampaignController);
router.post("/admin/:id/restore", protect, adminOnly, restoreMarketingCampaignController);
router.delete("/admin/:id", protect, adminOnly, purgeMarketingCampaignController);
router.post("/admin/:id/reset-stuck", protect, adminOnly, resetStuckMarketingCampaignController);
router.post("/admin/:id/schedule", protect, adminOnly, scheduleMarketingCampaignController);
router.post("/admin/:id/retry", protect, adminOnly, retryMarketingCampaign);

module.exports = router;
