const test = require("node:test");
const assert = require("node:assert/strict");

const SocialWeeklyPlan = require("../models/SocialWeeklyPlan");
const {
  DEFAULT_GROWTH_CONTENT_MIX,
  SOCIAL_HOOK_FORMULA,
  SOCIAL_SERIES_KEYS,
  getSocialManagerDefaults,
  normaliseSocialManagerSettings,
  validateSocialManagerSettings,
} = require("../utils/socialManagerSettings");

const EXPECTED_SLOTS = [
  ["MONDAY", 11, 0],
  ["TUESDAY", 18, 0],
  ["WEDNESDAY", 11, 0],
  ["THURSDAY", 18, 0],
  ["FRIDAY", 11, 0],
];

test("Social Manager v5 defaults to five weekday feeds and the approved four-week content contract", () => {
  const settings = getSocialManagerDefaults();

  assert.equal(settings.settings_version, 5);
  assert.equal(settings.weekly_planning.maximum_feed_posts, 5);
  assert.equal(settings.weekly_planning.max_feed_posts_per_week, 5);
  assert.equal(settings.weekly_planning.companion_stories_enabled, true);
  assert.deepEqual(
    settings.weekly_planning.posting_slots.map((slot) => [slot.weekday, slot.hour_ist, slot.minute_ist]),
    EXPECTED_SLOTS,
  );
  assert.deepEqual(settings.content_strategy.growth_content_mix, DEFAULT_GROWTH_CONTENT_MIX);
  assert.equal(Object.values(settings.content_strategy.growth_content_mix).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(settings.content_strategy.series_keys, SOCIAL_SERIES_KEYS);
  assert.deepEqual(settings.content_strategy.hook_formula, SOCIAL_HOOK_FORMULA);
  assert.equal(settings.content_strategy.talking_head_policy, "SCRIPT_SHOT_LIST_ONLY");
});

test("stored v2/v3 settings migrate to the five-feed cadence without invalidating historical plans", async () => {
  const migrated = normaliseSocialManagerSettings({
    settings_version: 3,
    weekly_planning: {
      maximum_feed_posts: 3,
      max_feed_posts_per_week: 3,
      companion_stories_enabled: false,
      posting_slots: [
        { slot_number: 1, weekday: "TUESDAY", hour_ist: 11, minute_ist: 0 },
        { slot_number: 2, weekday: "THURSDAY", hour_ist: 18, minute_ist: 0 },
        { slot_number: 3, weekday: "SATURDAY", hour_ist: 11, minute_ist: 0 },
      ],
    },
  });
  assert.equal(migrated.settings_version, 5);
  assert.equal(migrated.weekly_planning.maximum_feed_posts, 5);
  assert.equal(migrated.weekly_planning.companion_stories_enabled, true);
  assert.deepEqual(
    migrated.weekly_planning.posting_slots.map((slot) => [slot.weekday, slot.hour_ist, slot.minute_ist]),
    EXPECTED_SLOTS,
  );

  const historical = new SocialWeeklyPlan({
    week_key: "social-week:2026-08-24:legacy-v3",
    week_start: "2026-08-24",
    week_end: "2026-08-30",
    timezone: "Asia/Kolkata",
    status: "QUEUED",
    maximum_feed_posts: 3,
    idempotency_key: "social-weekly-plan:2026-08-24:legacy-v3",
    story_plan: undefined,
  });
  await historical.validate();
  assert.equal(historical.maximum_feed_posts, 3);
  assert.deepEqual(historical.story_plan.toObject(), []);
});

test("persisted weekly plans can be revalidated without rewriting their fixed timezone", async () => {
  const persisted = SocialWeeklyPlan.hydrate({
    week_key: "social-week:2026-08-31:timezone-regression",
    week_start: "2026-08-31",
    week_end: "2026-09-06",
    timezone: "Asia/Kolkata",
    status: "QUEUED",
    maximum_feed_posts: 5,
    idempotency_key: "social-weekly-plan:2026-08-31:timezone-regression",
    candidates: [],
    selected_posts: [],
    story_plan: [],
    version: 1,
  });

  persisted.status = "RESEARCHING";
  await persisted.validate();

  assert.equal(persisted.timezone, "Asia/Kolkata");
  assert.equal(persisted.isModified("timezone"), false);
});

test("legacy artwork-only settings migrate to mandatory branded artwork and cannot be saved again", () => {
  const migrated = normaliseSocialManagerSettings({
    settings_version: 4,
    generation: { default_visual_mode: "AI_ARTWORK_ONLY" },
  });

  assert.equal(migrated.settings_version, 5);
  assert.equal(migrated.generation.default_visual_mode, "AI_BRANDED_ARTWORK");
  assert.throws(
    () => validateSocialManagerSettings({
      generation: { default_visual_mode: "AI_ARTWORK_ONLY" },
    }, { partial: true }),
    /BRAND_LOGO_REQUIRED/
  );
});
