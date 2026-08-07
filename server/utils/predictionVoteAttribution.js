const BETA_LAUNCH_CAMPAIGN = "predictions_beta_launch";

function normalizePredictionVoteAttribution({ voteSource, campaign } = {}) {
  const normalizedSource = String(voteSource || "").trim().toLowerCase();
  const normalizedCampaign = String(campaign || "").trim().toLowerCase();

  if (normalizedSource === "beta_launch" && normalizedCampaign === BETA_LAUNCH_CAMPAIGN) {
    return {
      vote_source: "beta_launch",
      campaign: BETA_LAUNCH_CAMPAIGN,
    };
  }

  return {
    vote_source: "organic",
    campaign: null,
  };
}

module.exports = {
  BETA_LAUNCH_CAMPAIGN,
  normalizePredictionVoteAttribution,
};
