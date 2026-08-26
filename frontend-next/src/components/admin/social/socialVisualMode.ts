import { SocialFormatPreference } from "./types";

const ARTWORK_ONLY_FORMATS = new Set(["SINGLE_IMAGE", "CAROUSEL"]);
const ARTWORK_ONLY_OBJECTIVES = new Set(["AWARENESS", "EDUCATION", "ENGAGEMENT", "COMMUNITY_BUILDING"]);
const PROMOTIONAL_POST_PATTERN = /PRODUCT|AFFILIATE|PROMOTION|RESOURCE|EVENT|WORKSHOP/;

export type ArtworkOnlyEligibilityInput = {
  format?: SocialFormatPreference | string;
  objective?: string;
  postType?: string;
  contentPillar?: string;
  verifiedProductId?: string;
};

export type ArtworkOnlyEligibility = {
  eligible: boolean;
  reasons: string[];
  message: string;
};

export const artworkOnlyEligibility = (input: ArtworkOnlyEligibilityInput): ArtworkOnlyEligibility => {
  const format = String(input.format || "").toUpperCase();
  const objective = String(input.objective || "").toUpperCase();
  const postType = String(input.postType || "").toUpperCase();
  const pillar = String(input.contentPillar || "").toUpperCase();
  const reasons: string[] = [];

  if (!format || format === "AUTO_CHOOSE") reasons.push("FORMAT_NOT_SELECTED");
  else if (!ARTWORK_ONLY_FORMATS.has(format)) reasons.push("FORMAT_REQUIRES_OVERLAY");
  if (!objective || objective === "AUTO_CHOOSE") reasons.push("OBJECTIVE_NOT_SELECTED");
  else if (!ARTWORK_ONLY_OBJECTIVES.has(objective)) reasons.push("OBJECTIVE_REQUIRES_OVERLAY");
  if (input.verifiedProductId || PROMOTIONAL_POST_PATTERN.test(postType) || /AFFILIATE|PRODUCT|RESOURCE|WORKSHOP|EVENT/.test(pillar)) {
    reasons.push("PROMOTIONAL_OR_PRODUCT_CONTENT");
  }

  const uniqueReasons = [...new Set(reasons)];
  const messages: Record<string, string> = {
    FORMAT_NOT_SELECTED: "Choose Single Image or Carousel before selecting artwork-only.",
    FORMAT_REQUIRES_OVERLAY: "Artwork-only is limited to Single Image and Carousel posts.",
    OBJECTIVE_NOT_SELECTED: "Choose an eligible objective before selecting artwork-only.",
    OBJECTIVE_REQUIRES_OVERLAY: "Artwork-only supports awareness, education, engagement and community-building objectives only.",
    PROMOTIONAL_OR_PRODUCT_CONTENT: "Products, affiliate content, promotions, resources, events and workshops require verified overlays.",
  };
  return {
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    message: uniqueReasons.map((reason) => messages[reason]).join(" "),
  };
};
