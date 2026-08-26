const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldRunWeeklySocialPlanning,
  weeklySocialPlanningSchedule,
} = require("../services/dailyBatchScheduler");

const settings = {
  weekly_planning: {
    enabled: true,
    planning_weekday: "SUNDAY",
    planning_hour_ist: 18,
    planning_minute_ist: 0,
  },
};

test("weekly planning remains due after the configured minute so scheduler outages catch up once", () => {
  const exact = weeklySocialPlanningSchedule(new Date("2026-08-23T12:30:00.000Z"), settings);
  const minutesLate = weeklySocialPlanningSchedule(new Date("2026-08-23T12:43:00.000Z"), settings);
  const nextMorning = weeklySocialPlanningSchedule(new Date("2026-08-24T03:30:00.000Z"), settings);

  assert.equal(exact.due, true);
  assert.equal(minutesLate.due, true);
  assert.equal(nextMorning.due, true);
  assert.equal(exact.scheduled_at.toISOString(), "2026-08-23T12:30:00.000Z");
  assert.equal(exact.occurrence_key, "social-weekly-planning:2026-08-23:18:00");
  assert.equal(minutesLate.occurrence_key, exact.occurrence_key);
  assert.equal(nextMorning.occurrence_key, exact.occurrence_key);
});

test("weekly planning keeps weekday/time semantics across the next occurrence", () => {
  const beforeNextOccurrence = weeklySocialPlanningSchedule(new Date("2026-08-30T12:29:59.999Z"), settings);
  const nextOccurrence = weeklySocialPlanningSchedule(new Date("2026-08-30T12:30:00.000Z"), settings);

  assert.equal(beforeNextOccurrence.due, false, "the previous occurrence must not start the next plan early");
  assert.equal(beforeNextOccurrence.occurrence_key, "social-weekly-planning:2026-08-30:18:00");
  assert.equal(nextOccurrence.occurrence_key, "social-weekly-planning:2026-08-30:18:00");
  assert.equal(shouldRunWeeklySocialPlanning(new Date("2026-08-30T12:30:00.000Z"), settings), true);
  assert.equal(shouldRunWeeklySocialPlanning(new Date("2026-08-30T12:30:00.000Z"), {
    weekly_planning: { ...settings.weekly_planning, enabled: false },
  }), false);
});

test("invalid scheduling values fall back safely without changing the weekly cadence", () => {
  const schedule = weeklySocialPlanningSchedule(new Date("2026-08-24T04:00:00.000Z"), {
    weekly_planning: {
      enabled: true,
      planning_weekday: "NOT_A_DAY",
      planning_hour_ist: 99,
      planning_minute_ist: -5,
    },
  });

  assert.equal(schedule.occurrence_key, "social-weekly-planning:2026-08-23:23:00");
  assert.equal(schedule.scheduled_at.toISOString(), "2026-08-23T17:30:00.000Z");
});
