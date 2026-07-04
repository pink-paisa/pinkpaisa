const Poll = require("../models/Poll");
const PollVote = require("../models/PollVote");
const PollComment = require("../models/PollComment");
const { applyQueryParams } = require("./orderController");
const crypto = require("crypto");
const { getClientIp } = require("../middleware/requestGuards");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });
const PROFANITY_WORDS = ["fuck", "shit", "bitch", "bastard", "asshole", "slut"];

function hashIp(req) {
  return crypto.createHash("sha256").update(String(getClientIp(req) || "unknown")).digest("hex");
}

function containsProfanity(value) {
  const normalized = String(value || "").toLowerCase();
  return PROFANITY_WORDS.some((word) => normalized.includes(word));
}

// GET /api/polls
const getPolls = async (req, res) => {
  try {
    let q = Poll.find();
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ createdAt: -1 });
    const polls = await q.lean();
    res.json(polls.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/polls
const createPoll = async (req, res) => {
  try {
    const poll = await Poll.create(req.body);
    res.status(201).json(toFlat(poll.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/polls/:id
const updatePoll = async (req, res) => {
  try {
    const poll = await Poll.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!poll) return res.status(404).json({ message: "Poll not found" });
    res.json(toFlat(poll));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/polls/:id
const deletePoll = async (req, res) => {
  try {
    const poll = await Poll.findByIdAndDelete(req.params.id);
    if (!poll) return res.status(404).json({ message: "Poll not found" });
    // Clean up votes and comments
    await PollVote.deleteMany({ poll_id: req.params.id });
    await PollComment.deleteMany({ poll_id: req.params.id });
    res.json({ message: "Poll deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/polls/:id/vote  (replaces supabase.rpc("cast_vote"))
const castVote = async (req, res) => {
  try {
    const { p_poll_id, p_vote, p_fingerprint } = req.body;
    const pollId = req.params.id || p_poll_id;
    const vote = String(p_vote || req.body.vote || "").trim().toLowerCase();
    const fingerprint = String(p_fingerprint || req.body.voter_fingerprint || "").trim() || null;
    const userId = req.user?._id?.toString?.() || null;

    if (!pollId || !["yes", "no"].includes(vote)) {
      return res.status(400).json({ message: "Valid poll and vote are required" });
    }

    const duplicateChecks = [];
    if (userId) duplicateChecks.push({ poll_id: pollId, user_id: userId });
    if (fingerprint) duplicateChecks.push({ poll_id: pollId, voter_fingerprint: fingerprint });
    const existing = duplicateChecks.length
      ? await PollVote.findOne({ $or: duplicateChecks }).lean()
      : null;
    if (existing) {
      return res.status(409).json({ message: "duplicate key value", code: "23505" });
    }

    await PollVote.create({
      poll_id: pollId,
      user_id: userId,
      voter_fingerprint: fingerprint,
      ip_address_hash: hashIp(req),
      vote,
    });

    // Increment counter on poll
    const inc = vote === "yes" ? { yes_count: 1 } : { no_count: 1 };
    const poll = await Poll.findByIdAndUpdate(pollId, { $inc: inc }, { new: true }).lean();
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    res.json({ yes_count: poll.yes_count, no_count: poll.no_count });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "duplicate key value", code: "23505" });
    }
    res.status(500).json({ message: err.message });
  }
};

// GET /api/poll-votes?voter_fingerprint=xxx
const getPollVotes = async (req, res) => {
  try {
    const voterFingerprint = String(req.query.voter_fingerprint || "").trim();
    const userId = req.user?._id?.toString?.() || null;
    if (!voterFingerprint && !userId) return res.json([]);
    const clauses = [];
    if (userId) clauses.push({ user_id: userId });
    if (voterFingerprint) clauses.push({ voter_fingerprint: voterFingerprint });
    const votes = await PollVote.find(clauses.length === 1 ? clauses[0] : { $or: clauses }).lean();
    res.json(votes.map((v) => ({ ...v, id: v._id.toString() })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/poll-comments?poll_id=xxx
const getPollComments = async (req, res) => {
  try {
    const { poll_id } = req.query;
    const filter = poll_id ? { poll_id } : {};
    if (req.user?.role === "admin" && req.query.status) {
      filter.status = String(req.query.status);
    } else if (req.user?.role !== "admin") {
      filter.status = "visible";
    }
    const comments = await PollComment.find(filter).sort({ createdAt: 1 }).lean();
    res.json(comments.map((c) => ({ ...c, id: c._id.toString(), created_at: c.createdAt })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/poll-comments
const createComment = async (req, res) => {
  try {
    const pollId = String(req.body.poll_id || "").trim();
    const content = String(req.body.content || "").trim();
    const authorName = String(req.body.author_name || "").trim() || "Anonymous";
    if (!pollId || !content) {
      return res.status(400).json({ message: "Poll and comment content are required" });
    }

    const comment = await PollComment.create({
      poll_id: pollId,
      user_id: req.user?._id?.toString?.() || null,
      ip_address_hash: hashIp(req),
      author_name: authorName,
      content,
      status: req.user?._id && !containsProfanity(content) ? "visible" : "flagged",
    });
    const obj = comment.toObject();
    res.status(201).json({ ...obj, id: obj._id.toString(), created_at: obj.createdAt });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateComment = async (req, res) => {
  try {
    const payload = {};
    if (req.body.status) payload.status = String(req.body.status);
    if (req.body.moderation_note !== undefined) payload.moderation_note = String(req.body.moderation_note || "").trim() || null;
    const comment = await PollComment.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    res.json({ ...comment, id: comment._id.toString(), created_at: comment.createdAt });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteComment = async (req, res) => {
  try {
    const comment = await PollComment.findByIdAndDelete(req.params.id).lean();
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    res.json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
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
};
