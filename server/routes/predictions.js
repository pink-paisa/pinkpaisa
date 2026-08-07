const express = require("express");
const { createRateLimiter, getClientIp } = require("../middleware/requestGuards");
const {
  castDailyPredictionVote,
  getPublicDailyPredictions,
  recordDailyVoteRateLimit,
} = require("../services/dailyPredictionService");

const router = express.Router();
const voteLimiter = createRateLimiter({
  keyPrefix: "daily-prediction-vote",
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many prediction votes. Please slow down.",
  onLimit: recordDailyVoteRateLimit,
});

router.get("/daily", async (_req, res) => {
  try {
    res.json(await getPublicDailyPredictions());
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

router.post("/daily/:pollId/vote", voteLimiter, async (req, res) => {
  try {
    const result = await castDailyPredictionVote({
      pollId: String(req.params.pollId || "").trim(),
      vote: String(req.body.vote || "").trim().toLowerCase(),
      fingerprint: String(req.body.voter_fingerprint || "").trim(),
      ipAddress: getClientIp(req),
      voteSource: req.body.vote_source,
      campaign: req.body.campaign,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

module.exports = router;
