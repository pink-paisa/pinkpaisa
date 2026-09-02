const express = require("express");
const multer = require("multer");
const { protect, adminOnly } = require("../middleware/auth");
const controller = require("../controllers/socialMediaManagerController");
const growth = require("../controllers/socialGrowthController");
const orchestration = require("../controllers/socialOrchestrationController");
const audioLibrary = require("../controllers/socialAudioLibraryController");
const manualActions = require("../controllers/socialManualActionController");
const { requireSocialOrchestrationSignature } = require("../middleware/socialOrchestrationAuth");

const router = express.Router();
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
});

function receiveAudioUpload(req, res, next) {
  audioUpload.single("audio")(req, res, (error) => {
    if (!error) return next();
    const fileTooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(fileTooLarge ? 413 : 400).json({
      message: fileTooLarge ? "Audio files must be 25 MB or smaller" : "The audio upload could not be processed",
      code: fileTooLarge ? "social_audio_file_too_large" : "social_audio_upload_invalid",
    });
  });
}

router.post("/orchestration/weekly-plan", requireSocialOrchestrationSignature, orchestration.weeklyPlan);
router.post("/orchestration/prepublication", requireSocialOrchestrationSignature, orchestration.prepublication);
router.post("/orchestration/metrics", requireSocialOrchestrationSignature, orchestration.metrics);

router.use(protect, adminOnly);
router.get("/admin/today", controller.getToday);
router.get("/admin/work-summary", growth.workSummary);
router.get("/admin/connections", growth.connections);
router.post("/admin/connections/check", growth.checkConnections);
router.get("/admin/weekly-plans/current", growth.currentWeeklyPlan);
router.post("/admin/weekly-plans/generate", growth.generateWeeklyPlan);
router.post("/admin/weekly-plans/:id/approve", growth.approvePlan);
router.post("/admin/weekly-plans/:id/reject", growth.rejectPlan);
router.post("/admin/weekly-plans/:id/slots/:slotNumber/replace", growth.replacePlanSlot);
router.post("/admin/weekly-plans/:id/produce/:candidateId", growth.producePlanPost);
router.get("/admin/research/weekly", growth.weeklyResearch);
router.get("/admin/analytics/summary", growth.analyticsSummary);
router.post("/admin/analytics/refresh", growth.refreshAnalytics);
router.get("/admin/community", growth.community);
router.post("/admin/community/:id/recommend", growth.recommendReply);
router.post("/admin/community/:id/approve", growth.approveReply);
router.post("/admin/community/:id/approve-and-send", growth.approveAndSendReply);
router.post("/admin/community/:id/reject", growth.rejectReply);
router.post("/admin/community/:id/send", growth.sendReply);
router.post("/admin/community/:id/reconcile", growth.reconcileReply);
router.post("/admin/community/:id/acknowledge-escalation", growth.acknowledgeEscalation);
router.post("/admin/community/:id/resolve-escalation", growth.resolveEscalation);
router.get("/admin/generated-content/cleanup-preview", controller.generatedContentCleanupPreview);
router.delete("/admin/generated-content", controller.cleanupGeneratedContent);
router.post("/admin/generate", controller.generate);
router.get("/admin/drafts", controller.listDrafts);
router.get("/admin/settings", controller.getSettings);
router.put("/admin/settings", controller.updateSettings);
router.get("/admin/audio-library", audioLibrary.list);
router.post("/admin/audio-library", receiveAudioUpload, audioLibrary.upload);
router.get("/admin/audio-library/:id/file", audioLibrary.stream);
router.patch("/admin/audio-library/:id", audioLibrary.update);
router.delete("/admin/audio-library/:id", audioLibrary.deactivate);
router.get("/admin/manual-actions", manualActions.list);
router.get("/admin/manual-actions/:id", manualActions.get);
router.patch("/admin/manual-actions/:id", manualActions.update);
router.post("/admin/publications/:id/reconcile", controller.reconcilePublication);
router.get("/admin/performance", controller.performance);
router.get("/admin/runs/:id", controller.getRun);
router.post("/admin/runs/:id/retry", controller.retryRun);
router.post("/admin/runs/:id/archive-failure", controller.archiveRunFailure);
router.get("/admin/drafts/:id", controller.getDraft);
router.post("/admin/drafts/:id/audio-track", audioLibrary.selectForDraft);
router.patch("/admin/drafts/:id", controller.updateDraft);
router.post("/admin/drafts/:id/submit-review", controller.submitReview);
router.post("/admin/drafts/:id/approve", controller.approve);
router.post("/admin/drafts/:id/approve-and-schedule", controller.approveAndSchedule);
router.post("/admin/drafts/:id/reject", controller.reject);
router.post("/admin/drafts/:id/schedule", controller.schedule);
router.post("/admin/drafts/:id/publish", controller.publish);
router.post("/admin/drafts/:id/duplicate", controller.duplicate);
router.post("/admin/drafts/:id/regenerate", controller.regenerate);
router.post("/admin/drafts/:id/assets/render", controller.renderAssets);
router.post("/admin/drafts/:id/fact-check", controller.factCheck);
router.post("/admin/drafts/:id/metrics", controller.addMetrics);
router.get("/admin/drafts/:id/publishing-readiness", controller.publishingReadiness);

module.exports = router;
