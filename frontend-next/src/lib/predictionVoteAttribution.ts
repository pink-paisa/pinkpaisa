export type PredictionVoteAttribution = {
  vote_source: "organic" | "beta_launch";
  campaign: "predictions_beta_launch" | null;
};

const STORAGE_KEY = "pp_prediction_vote_source";
const BETA_CAMPAIGN = "predictions_beta_launch";

export function capturePredictionVoteAttribution(): PredictionVoteAttribution {
  if (typeof window === "undefined") return { vote_source: "organic", campaign: null };

  const params = new URLSearchParams(window.location.search);
  const hasCampaignParams = params.has("utm_source") || params.has("utm_medium") || params.has("utm_campaign");
  const isBetaLaunch = params.get("utm_source") === "beta_group"
    && params.get("utm_medium") === "community"
    && params.get("utm_campaign") === BETA_CAMPAIGN;

  if (isBetaLaunch) {
    sessionStorage.setItem(STORAGE_KEY, "beta_launch");
  } else if (hasCampaignParams) {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  return getPredictionVoteAttribution();
}

export function getPredictionVoteAttribution(): PredictionVoteAttribution {
  if (typeof window !== "undefined" && sessionStorage.getItem(STORAGE_KEY) === "beta_launch") {
    return { vote_source: "beta_launch", campaign: BETA_CAMPAIGN };
  }
  return { vote_source: "organic", campaign: null };
}
