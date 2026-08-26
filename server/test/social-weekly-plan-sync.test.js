const test = require("node:test");
const assert = require("node:assert/strict");

const {
  syncWeeklyPlanFromDraft,
} = require("../services/social/socialWeeklyPlanSyncService");

function planFixture() {
  return {
    _id: "weekly-plan-1",
    status: "APPROVED",
    selected_posts: ["candidate-1", "candidate-2", "candidate-3"].map((candidateId) => ({
      candidateId,
      status: "APPROVED",
      generation_run_id: `run-${candidateId}`,
      draft_id: null,
      publication_id: null,
    })),
    async save() { return this; },
  };
}

function draft(candidateId) {
  return {
    _id: `draft-${candidateId}`,
    weekly_plan_id: "weekly-plan-1",
    candidate_id: candidateId,
    generation_run_id: `run-${candidateId}`,
  };
}

test("linked draft lifecycle keeps the selected weekly post and top-level plan current", async () => {
  const plan = planFixture();
  const dependencies = { SocialWeeklyPlan: { findById: async () => plan } };

  for (const candidateId of ["candidate-1", "candidate-2", "candidate-3"]) {
    await syncWeeklyPlanFromDraft(draft(candidateId), { status: "SCHEDULED", dependencies });
  }
  assert.equal(plan.status, "SCHEDULED");
  assert.ok(plan.selected_posts.every((selected) => selected.status === "SCHEDULED"));
  assert.deepEqual(plan.selected_posts.map((selected) => selected.draft_id), [
    "draft-candidate-1",
    "draft-candidate-2",
    "draft-candidate-3",
  ]);

  await syncWeeklyPlanFromDraft(draft("candidate-1"), {
    status: "PUBLISHED",
    publicationId: "publication-1",
    dependencies,
  });
  assert.equal(plan.status, "ACTIVE");
  assert.equal(plan.selected_posts[0].publication_id, "publication-1");

  await syncWeeklyPlanFromDraft(draft("candidate-2"), { status: "PUBLISHED", publicationId: "publication-2", dependencies });
  await syncWeeklyPlanFromDraft(draft("candidate-3"), { status: "PUBLISHED", publicationId: "publication-3", dependencies });
  assert.equal(plan.status, "COMPLETED");
  assert.ok(plan.selected_posts.every((selected) => selected.status === "PUBLISHED"));
});

test("weekly lifecycle synchronization fails closed on a broken candidate link", async () => {
  const plan = planFixture();
  await assert.rejects(
    () => syncWeeklyPlanFromDraft(draft("candidate-missing"), {
      status: "APPROVED",
      dependencies: { SocialWeeklyPlan: { findById: async () => plan } },
    }),
    (error) => error.code === "social_weekly_candidate_link_missing",
  );
});

test("approval-invalidating draft changes return a scheduled weekly item to visible review", async () => {
  const plan = planFixture();
  plan.status = "SCHEDULED";
  plan.selected_posts.forEach((selected) => { selected.status = "SCHEDULED"; });
  const dependencies = { SocialWeeklyPlan: { findById: async () => plan } };

  await syncWeeklyPlanFromDraft({ ...draft("candidate-2"), status: "DRAFT" }, { dependencies });

  assert.equal(plan.selected_posts[1].status, "NEEDS_REVIEW");
  assert.equal(plan.status, "APPROVED");
  assert.equal(plan.selected_posts[0].status, "SCHEDULED");
  assert.equal(plan.selected_posts[2].status, "SCHEDULED");
});
