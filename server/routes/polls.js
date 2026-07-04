const express = require("express");
const router = express.Router();
const {
  getPolls,
  createPoll,
  updatePoll,
  deletePoll,
  castVote,
  getPollVotes,
  getPollComments,
  createComment,
  updateComment,
  deleteComment,
} = require("../controllers/pollController");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/requestGuards");
const { requireCaptcha } = require("../middleware/captcha");

const voteLimiter = createRateLimiter({
  keyPrefix: "poll-vote",
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many votes from this IP. Please slow down.",
});

const commentLimiter = createRateLimiter({
  keyPrefix: "poll-comment",
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many comments from this IP. Please slow down.",
});

// Polls
router.get("/", getPolls);
router.post("/", protect, adminOnly, createPoll);
router.put("/:id", protect, adminOnly, updatePoll);
router.delete("/:id", protect, adminOnly, deletePoll);
router.post("/:id/vote", optionalProtect, voteLimiter, castVote);

// Poll votes
router.get("/votes", optionalProtect, getPollVotes);

// Poll comments
router.get("/comments", optionalProtect, getPollComments);
router.post("/comments", optionalProtect, commentLimiter, requireCaptcha(), createComment);
router.put("/comments/:id", protect, adminOnly, updateComment);
router.delete("/comments/:id", protect, adminOnly, deleteComment);

module.exports = router;
