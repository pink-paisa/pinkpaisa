const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialWeeklyCapacityGuard = require("../../models/SocialWeeklyCapacityGuard");

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function shiftedIstDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid date is required");
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function dateKeyFromShifted(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function istDateKey(value = new Date()) {
  return dateKeyFromShifted(shiftedIstDate(value));
}

function utcFromIstParts(year, monthIndex, day, hour = 0, minute = 0, second = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute, second) - IST_OFFSET_MS);
}

function weekBoundsForDate(value = new Date(), { planNextWeekOnSunday = false } = {}) {
  const shifted = shiftedIstDate(value);
  const weekday = shifted.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday + (planNextWeekOnSunday && weekday === 0 ? 7 : 0));
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const sunday = new Date(nextMonday);
  sunday.setUTCDate(sunday.getUTCDate() - 1);
  return {
    week_key: dateKeyFromShifted(monday),
    week_start: dateKeyFromShifted(monday),
    week_end: dateKeyFromShifted(sunday),
    start_utc: utcFromIstParts(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()),
    end_utc: utcFromIstParts(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth(), nextMonday.getUTCDate()),
    timezone: "Asia/Kolkata",
  };
}

function dateKeyAddDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + Number(days || 0));
  return dateKeyFromShifted(shifted);
}

function isoForIstSlot(weekStart, weekday, hour = 11, minute = 0) {
  const weekdayOffsets = {
    MONDAY: 0,
    TUESDAY: 1,
    WEDNESDAY: 2,
    THURSDAY: 3,
    FRIDAY: 4,
    SATURDAY: 5,
    SUNDAY: 6,
  };
  const normalizedWeekday = String(weekday || "").trim().toUpperCase();
  if (!Object.hasOwn(weekdayOffsets, normalizedWeekday)) throw new Error(`Unsupported posting weekday ${weekday}`);
  const dateKey = dateKeyAddDays(weekStart, weekdayOffsets[normalizedWeekday]);
  const [year, month, day] = dateKey.split("-").map(Number);
  return utcFromIstParts(year, month - 1, day, Number(hour), Number(minute)).toISOString();
}

function configuredWeeklyMaximum(settings = {}) {
  const value = settings.weekly_planning?.maximum_feed_posts
    ?? settings.weekly?.maximum_feed_posts
    ?? settings.max_feed_posts_per_week
    ?? process.env.SOCIAL_MAX_FEED_POSTS_PER_WEEK
    ?? 3;
  return Math.min(Math.max(Number(value) || 3, 1), 7);
}

async function getWeeklyPublicationUsage({ at = new Date(), excludeDraftId = null, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const bounds = weekBoundsForDate(at);
  const query = {
    ...(excludeDraftId ? { _id: { $ne: excludeDraftId } } : {}),
    "current_package.primaryRecommendation.format": { $ne: "STORY" },
    $or: [
      {
        status: { $in: ["SCHEDULED", "PUBLISHING"] },
        scheduled_for: { $gte: bounds.start_utc, $lt: bounds.end_utc },
      },
      {
        status: "PUBLISHED",
        published_at: { $gte: bounds.start_utc, $lt: bounds.end_utc },
      },
    ],
  };
  const countQuery = typeof DraftModel.countDocuments === "function" ? DraftModel.countDocuments(query) : 0;
  const used = dependencies.mongoSession && countQuery && typeof countQuery.session === "function"
    ? await countQuery.session(dependencies.mongoSession)
    : await countQuery;
  return { ...bounds, used: Number(used || 0) };
}

async function acquireWeeklyCapacityGuard({ at, draftId = null, maximum, dependencies = {} } = {}) {
  const session = dependencies.mongoSession || null;
  if (!session) {
    const error = new Error("A Mongo transaction is required to reserve weekly social publication capacity");
    error.code = "social_weekly_capacity_transaction_required";
    error.statusCode = 503;
    throw error;
  }
  const GuardModel = dependencies.SocialWeeklyCapacityGuard || SocialWeeklyCapacityGuard;
  const bounds = weekBoundsForDate(at);
  // This document is a transaction fence, not a second source of capacity
  // truth. Every feed scheduler writes the same week row before counting
  // drafts, so concurrent transactions conflict and retry serially. The
  // authoritative draft query remains naturally releasable when a draft is
  // rejected, edited, fails, or moves week; no reservation can leak.
  const query = GuardModel.findOneAndUpdate(
    { _id: bounds.week_key },
    {
      $setOnInsert: {
        week_start: bounds.week_start,
        week_end: bounds.week_end,
        timezone: bounds.timezone,
      },
      $inc: { fence: 1 },
      $max: { maximum_seen: maximum },
      $set: {
        last_draft_id: draftId ? String(draftId) : null,
        last_scheduled_for: new Date(at),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
      session,
    },
  );
  const guard = await query;
  if (!guard) {
    const error = new Error(`Weekly social publication capacity for ${bounds.week_start} could not be reserved`);
    error.code = "social_weekly_capacity_guard_unavailable";
    error.statusCode = 503;
    throw error;
  }
  return guard;
}

async function assertWeeklyPublicationCapacity({ at, draftId = null, settings = {}, serialize = false, dependencies = {} } = {}) {
  const maximum = configuredWeeklyMaximum(settings);
  if (serialize) {
    await acquireWeeklyCapacityGuard({ at, draftId, maximum, dependencies });
  }
  const usage = await getWeeklyPublicationUsage({ at, excludeDraftId: draftId, dependencies });
  if (usage.used >= maximum) {
    const error = new Error(`The ${maximum}-post Instagram feed maximum is already filled for week ${usage.week_start}.`);
    error.code = "social_weekly_publication_maximum_reached";
    error.statusCode = 409;
    error.details = { week_start: usage.week_start, week_end: usage.week_end, maximum, used: usage.used };
    throw error;
  }
  return { ...usage, maximum, remaining_after: Math.max(maximum - usage.used - 1, 0) };
}

module.exports = {
  IST_OFFSET_MS,
  acquireWeeklyCapacityGuard,
  assertWeeklyPublicationCapacity,
  configuredWeeklyMaximum,
  dateKeyAddDays,
  getWeeklyPublicationUsage,
  isoForIstSlot,
  istDateKey,
  utcFromIstParts,
  weekBoundsForDate,
};
