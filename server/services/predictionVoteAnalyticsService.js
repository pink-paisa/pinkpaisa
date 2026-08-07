const Poll = require("../models/Poll");
const PollVote = require("../models/PollVote");
const mongoose = require("mongoose");

function emptyVoteAnalytics() {
  return {
    total_genuine_votes: 0,
    beta_launch_votes: 0,
    organic_votes: 0,
    unique_voting_fingerprints: 0,
    duplicate_attempts: 0,
    rate_limited_attempts: 0,
    by_prediction: [],
  };
}

async function getEditorialVoteAnalytics() {
  const [sourceRows, uniqueRows, predictionRows] = await Promise.all([
    PollVote.aggregate([
      {
        $group: {
          _id: { $cond: [{ $eq: ["$vote_source", "beta_launch"] }, "beta_launch", "organic"] },
          count: { $sum: 1 },
        },
      },
    ]),
    PollVote.aggregate([
      { $project: { voter_key: { $ifNull: ["$voter_fingerprint", "$user_id"] } } },
      { $match: { voter_key: { $nin: [null, ""] } } },
      { $group: { _id: "$voter_key" } },
      { $count: "count" },
    ]),
    PollVote.aggregate([
      {
        $group: {
          _id: {
            poll_id: "$poll_id",
            source: { $cond: [{ $eq: ["$vote_source", "beta_launch"] }, "beta_launch", "organic"] },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const sourceCounts = Object.fromEntries(sourceRows.map((row) => [row._id, Number(row.count || 0)]));
  const grouped = new Map();
  predictionRows.forEach((row) => {
    const pollId = String(row._id.poll_id);
    const current = grouped.get(pollId) || { id: pollId, beta_launch_votes: 0, organic_votes: 0 };
    current[`${row._id.source}_votes`] = Number(row.count || 0);
    grouped.set(pollId, current);
  });
  const pollIds = [...grouped.keys()];
  const validPollIds = pollIds.filter((pollId) => mongoose.Types.ObjectId.isValid(pollId));
  const polls = validPollIds.length
    ? await Poll.find({ _id: { $in: validPollIds } }).select("question").lean()
    : [];
  const questions = new Map(polls.map((poll) => [String(poll._id), poll.question]));
  const byPrediction = [...grouped.values()].map((row) => ({
    ...row,
    question: questions.get(row.id) || "Deleted editorial poll",
    source_type: "editorial",
    total_votes: row.beta_launch_votes + row.organic_votes,
  }));
  const betaVotes = Number(sourceCounts.beta_launch || 0);
  const organicVotes = Number(sourceCounts.organic || 0);

  return {
    ...emptyVoteAnalytics(),
    total_genuine_votes: betaVotes + organicVotes,
    beta_launch_votes: betaVotes,
    organic_votes: organicVotes,
    unique_voting_fingerprints: Number(uniqueRows[0]?.count || 0),
    by_prediction: byPrediction,
  };
}

function combinePredictionVoteAnalytics(editorial, daily) {
  const safeEditorial = editorial || emptyVoteAnalytics();
  const safeDaily = daily || emptyVoteAnalytics();
  return {
    total_genuine_votes: safeEditorial.total_genuine_votes + safeDaily.total_genuine_votes,
    beta_launch_votes: safeEditorial.beta_launch_votes + safeDaily.beta_launch_votes,
    organic_votes: safeEditorial.organic_votes + safeDaily.organic_votes,
    unique_voting_fingerprints: safeEditorial.unique_voting_fingerprints + safeDaily.unique_voting_fingerprints,
    duplicate_attempts: safeDaily.duplicate_attempts,
    rate_limited_attempts: safeDaily.rate_limited_attempts,
    editorial: safeEditorial,
    daily: safeDaily,
    by_prediction: [...safeDaily.by_prediction, ...safeEditorial.by_prediction],
  };
}

module.exports = {
  combinePredictionVoteAnalytics,
  emptyVoteAnalytics,
  getEditorialVoteAnalytics,
};
