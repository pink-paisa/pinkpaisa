const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");

const SELECTED_STATUS = new Set(SocialWeeklyPlan.SELECTED_POST_STATUSES || []);

function applyMongoSession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

function derivePlanStatus(plan) {
  const statuses = [...(plan.selected_posts || []), ...(plan.story_plan || [])]
    .map((selected) => String(selected.status || "PLANNED").toUpperCase());
  if (statuses.length && statuses.every((status) => status === "PUBLISHED")) return "COMPLETED";
  if (statuses.some((status) => status === "PUBLISHED")) return "ACTIVE";
  if (statuses.length && statuses.every((status) => ["SCHEDULED", "PUBLISHED"].includes(status))) return "SCHEDULED";
  if (["APPROVED", "SCHEDULED", "ACTIVE", "COMPLETED"].includes(String(plan.status || "").toUpperCase())) return "APPROVED";
  return plan.status;
}

function normalizeSelectedStatus(status) {
  const value = String(status || "").toUpperCase();
  if (["DRAFT", "REVISION_REQUIRED", "COMPLIANCE_REVIEW"].includes(value)) return "NEEDS_REVIEW";
  if (value.startsWith("FAILED_")) return "FAILED";
  if (value === "PUBLISHING") return "SCHEDULED";
  return value;
}

async function syncWeeklyPlanFromDraft(draft, { status, publicationId = null, dependencies = {} } = {}) {
  if (!draft?.weekly_plan_id || !draft?.candidate_id) return null;
  const normalizedStatus = normalizeSelectedStatus(status || draft.status);
  if (!SELECTED_STATUS.has(normalizedStatus)) {
    const error = new Error(`Unsupported weekly selected-post status ${normalizedStatus}`);
    error.code = "social_weekly_status_invalid";
    throw error;
  }
  const PlanModel = dependencies.SocialWeeklyPlan || SocialWeeklyPlan;
  const session = dependencies.mongoSession || null;
  const plan = await applyMongoSession(PlanModel.findById(draft.weekly_plan_id), session);
  if (!plan) {
    const error = new Error("The draft's linked weekly plan no longer exists");
    error.code = "social_weekly_plan_link_missing";
    throw error;
  }
  const selected = [...(plan.selected_posts || []), ...(plan.story_plan || [])].find((item) => (
    String(item.candidateId || item.candidate_id || "") === String(draft.candidate_id)
  ));
  if (!selected) {
    const error = new Error("The draft's linked weekly candidate no longer exists");
    error.code = "social_weekly_candidate_link_missing";
    throw error;
  }
  selected.status = normalizedStatus;
  selected.draft_id = draft._id;
  selected.generation_run_id = draft.generation_run_id || selected.generation_run_id || null;
  if (publicationId || draft.publication_id) selected.publication_id = publicationId || draft.publication_id;
  plan.status = derivePlanStatus(plan);
  await plan.save(session ? { session } : undefined);
  return plan;
}

module.exports = { derivePlanStatus, normalizeSelectedStatus, syncWeeklyPlanFromDraft };
