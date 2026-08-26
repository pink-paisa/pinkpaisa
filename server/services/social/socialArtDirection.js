const ART_DIRECTION_SYSTEM_VERSION = "pink-paisa-art-direction-v1";

const ART_DIRECTIONS = Object.freeze({
  EDITORIAL_ICON_GRID: Object.freeze({
    id: "EDITORIAL_ICON_GRID",
    label: "Premium editorial icon grid",
    role: "PRIMARY",
    prompt: [
      "Use Pink Paisa's premium editorial icon-grid system: a sophisticated financial-magazine composition with an asymmetric modular grid, expressive custom editorial icons, bold typographic rhythm, refined line work and subtle paper grain.",
      "Build the visual story across the full canvas. Integrate topic-specific icons and illustrated subjects into the grid; any newspaper or document icon must use abstract lines and shapes rather than legible glyphs.",
      "Treat text-safe space as a designed part of the asymmetric grid, never as a blank stock-photo area, large floating white card, generic rounded rectangle or template panel.",
      "Use warm ivory, deep wine and raspberry-magenta with one restrained cobalt accent. Keep the result authoritative, intelligent, contemporary, warm and women-first without stereotypes.",
    ].join(" "),
  }),
  BOLD_EDITORIAL_COLLAGE: Object.freeze({
    id: "BOLD_EDITORIAL_COLLAGE",
    label: "Bold mixed-media editorial collage",
    role: "SECONDARY",
    prompt: [
      "Use Pink Paisa's bold mixed-media editorial-collage system: sophisticated cut-paper shapes, screenprint forms, refined halftone texture, torn-edge news motifs and hand-drawn icon accents.",
      "Build an energetic full-canvas composition with topic-specific illustrated icons. Any newspaper, receipt or document element must use abstract lines and shapes rather than legible glyphs.",
      "Integrate text-safe space as an intentional torn-paper or strong color-field region within the artwork, never as a stock-photo gap, large floating white card, generic rounded rectangle or corporate template panel.",
      "Use raspberry, vermilion-coral, deep burgundy, butter cream and selective ink black. Keep the result fearless, smart, artistic, mobile-readable and contemporary Indian without stereotypes or scrapbook clutter.",
    ].join(" "),
  }),
});

const BOLD_FORMATS = new Set(["MEME", "QUIZ", "POLL"]);
const BOLD_OBJECTIVES = new Set(["ENGAGEMENT", "COMMUNITY_BUILDING"]);
const BOLD_POST_TYPES = new Set(["ENGAGEMENT", "QUIZ"]);
const BOLD_PILLARS = new Set(["RELATABLE MONEY MOMENTS", "INTERACTIVE"]);

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
  return null;
}

function resolvePinkPaisaArtDirection(recommendation = {}, explicitDirection = null) {
  const explicit = normalized(explicitDirection);
  if (ART_DIRECTIONS[explicit]) return ART_DIRECTIONS[explicit];

  const formatContent = recommendation.formatContent || recommendation.format_content || {};
  const format = normalized(firstValue(recommendation, ["format"]) || firstValue(formatContent, ["format"]));
  const objective = normalized(firstValue(recommendation, ["objective"]) || firstValue(formatContent, ["objective"]));
  const postType = normalized(
    firstValue(recommendation, ["postType", "post_type"])
    || firstValue(formatContent, ["postType", "post_type"]),
  );
  const contentPillar = normalized(
    firstValue(recommendation, ["contentPillar", "content_pillar"])
    || firstValue(formatContent, ["contentPillar", "content_pillar"]),
  );

  if (
    BOLD_FORMATS.has(format)
    || BOLD_OBJECTIVES.has(objective)
    || BOLD_POST_TYPES.has(postType)
    || BOLD_PILLARS.has(contentPillar)
  ) {
    return ART_DIRECTIONS.BOLD_EDITORIAL_COLLAGE;
  }
  return ART_DIRECTIONS.EDITORIAL_ICON_GRID;
}

function serializePinkPaisaArtDirection(direction) {
  const resolved = ART_DIRECTIONS[normalized(direction?.id || direction)] || ART_DIRECTIONS.EDITORIAL_ICON_GRID;
  return {
    id: resolved.id,
    label: resolved.label,
    role: resolved.role,
    system_version: ART_DIRECTION_SYSTEM_VERSION,
  };
}

module.exports = {
  ART_DIRECTIONS,
  ART_DIRECTION_SYSTEM_VERSION,
  resolvePinkPaisaArtDirection,
  serializePinkPaisaArtDirection,
};
