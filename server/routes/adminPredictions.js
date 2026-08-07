const express = require("express");
const { protect, adminOnly } = require("../middleware/auth");
const {
  clearCurrentPredictions,
  generateDailyPredictions,
  getAdminPredictionStatus,
  removeCurrentQuestion,
} = require("../services/dailyPredictionService");
const { savePredictionSettings } = require("../utils/predictionSettings");
const {
  combinePredictionVoteAnalytics,
  getEditorialVoteAnalytics,
} = require("../services/predictionVoteAnalyticsService");

const router = express.Router();
router.use(protect, adminOnly);

router.get("/", async (_req, res) => {
  try {
    const [status, editorialAnalytics] = await Promise.all([
      getAdminPredictionStatus(),
      getEditorialVoteAnalytics(),
    ]);
    res.json({
      ...status,
      vote_analytics: combinePredictionVoteAnalytics(editorialAnalytics, status.daily_vote_analytics),
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

router.put("/", async (req, res) => {
  try {
    const settings = await savePredictionSettings({
      predictions_ai_enabled: req.body.predictions_ai_enabled,
      predictions_daily_count: req.body.predictions_daily_count,
      predictions_generation_hour_ist: req.body.predictions_generation_hour_ist,
      predictions_generation_minute_ist: req.body.predictions_generation_minute_ist,
    });
    res.json({ message: "Daily prediction settings updated", ...settings });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/generate-now", async (_req, res) => {
  try {
    const result = await generateDailyPredictions({ force: true });
    res.status(result.skipped ? 409 : 201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

router.delete("/current/:pollId", async (req, res) => {
  try {
    const removed = await removeCurrentQuestion(String(req.params.pollId || ""));
    if (!removed) return res.status(404).json({ message: "Daily prediction not found" });
    return res.json({ message: "Daily prediction removed" });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message });
  }
});

router.post("/current/clear", async (_req, res) => {
  try {
    res.json({ message: "Current daily predictions cleared", ...(await clearCurrentPredictions()) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

module.exports = router;
