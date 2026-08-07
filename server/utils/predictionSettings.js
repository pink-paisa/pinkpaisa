const AdminSettings = require("../models/AdminSettings");

const PREDICTION_SETTINGS_KEY = "predictions_ai";
const MIN_DAILY_QUESTIONS = 10;
const MAX_DAILY_QUESTIONS = 20;
const SETTINGS_CACHE_MS = 30 * 1000;
let cachedSettings = null;
let cachedSettingsExpiresAt = 0;

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "true";
}

function getPredictionDefaults() {
  return {
    predictions_ai_enabled: parseBoolean(process.env.PREDICTIONS_AI_ENABLED, false),
    predictions_daily_count: clampInteger(
      process.env.PREDICTIONS_DAILY_COUNT,
      15,
      MIN_DAILY_QUESTIONS,
      MAX_DAILY_QUESTIONS
    ),
    predictions_generation_hour_ist: clampInteger(
      process.env.PREDICTIONS_GENERATION_HOUR_IST,
      6,
      0,
      23
    ),
    predictions_generation_minute_ist: clampInteger(
      process.env.PREDICTIONS_GENERATION_MINUTE_IST,
      0,
      0,
      59
    ),
  };
}

function normalizePredictionSettings(value = {}) {
  const defaults = getPredictionDefaults();
  return {
    predictions_ai_enabled: parseBoolean(
      value.predictions_ai_enabled,
      defaults.predictions_ai_enabled
    ),
    predictions_daily_count: clampInteger(
      value.predictions_daily_count,
      defaults.predictions_daily_count,
      MIN_DAILY_QUESTIONS,
      MAX_DAILY_QUESTIONS
    ),
    predictions_generation_hour_ist: clampInteger(
      value.predictions_generation_hour_ist,
      defaults.predictions_generation_hour_ist,
      0,
      23
    ),
    predictions_generation_minute_ist: clampInteger(
      value.predictions_generation_minute_ist,
      defaults.predictions_generation_minute_ist,
      0,
      59
    ),
  };
}

async function getPredictionSettings() {
  if (cachedSettings && cachedSettingsExpiresAt > Date.now()) return { ...cachedSettings };
  const settings = await AdminSettings.findOne({ key: PREDICTION_SETTINGS_KEY }).lean();
  cachedSettings = normalizePredictionSettings(settings || {});
  cachedSettingsExpiresAt = Date.now() + SETTINGS_CACHE_MS;
  return { ...cachedSettings };
}

async function savePredictionSettings(input = {}) {
  const current = await getPredictionSettings();
  const provided = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const updates = normalizePredictionSettings({ ...current, ...provided });
  const settings = await AdminSettings.findOneAndUpdate(
    { key: PREDICTION_SETTINGS_KEY },
    { $set: updates },
    { new: true, upsert: true, lean: true }
  );
  cachedSettings = normalizePredictionSettings(settings);
  cachedSettingsExpiresAt = Date.now() + SETTINGS_CACHE_MS;
  return { ...cachedSettings };
}

module.exports = {
  MAX_DAILY_QUESTIONS,
  MIN_DAILY_QUESTIONS,
  PREDICTION_SETTINGS_KEY,
  getPredictionDefaults,
  getPredictionSettings,
  normalizePredictionSettings,
  savePredictionSettings,
};
