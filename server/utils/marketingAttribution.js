const TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "landing_path",
  "referrer",
];

const TOUCH_LIMITS = {
  utm_source: 120,
  utm_medium: 120,
  utm_campaign: 160,
  utm_content: 160,
  utm_term: 160,
  gclid: 240,
  fbclid: 240,
  landing_path: 500,
  referrer: 500,
};
function boundedString(value, max) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeTouch(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const touch = {};
  for (const key of TOUCH_KEYS) {
    touch[key] = boundedString(source[key], TOUCH_LIMITS[key]);
  }
  const capturedAt = source.captured_at ? new Date(source.captured_at) : null;
  touch.captured_at = capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : new Date();
  return touch;
}

function normalizeMarketingAttribution(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    first_touch: normalizeTouch(source.first_touch),
    last_touch: normalizeTouch(source.last_touch || source.first_touch),
  };
}

function attributionPersistenceFields(input) {
  const attribution = normalizeMarketingAttribution(input);
  return {
    attribution_first_touch: attribution.first_touch,
    attribution_last_touch: attribution.last_touch,
  };
}

module.exports = {
  TOUCH_KEYS,
  attributionPersistenceFields,
  normalizeMarketingAttribution,
  normalizeTouch,
};
