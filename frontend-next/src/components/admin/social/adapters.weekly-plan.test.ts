import { describe, expect, it } from "vitest";
import { normalizeWeeklyPlanResponse } from "./adapters";

describe("weekly plan cadence adapters", () => {
  it("keeps historical three-post plans readable when story_plan is absent", () => {
    const plan = normalizeWeeklyPlanResponse({ plan: {
      _id: "legacy-three-post-plan",
      status: "COMPLETED",
      week_start: "2026-08-24",
      week_end: "2026-08-30",
      maximum_feed_posts: 3,
      selected_posts: [1, 2, 3].map((slot) => ({
        candidate_id: `legacy-candidate-${slot}`,
        slot_number: slot,
        status: "PUBLISHED",
        scheduled_for: `2026-08-${23 + slot}T05:30:00.000Z`,
        draft_id: `legacy-draft-${slot}`,
        candidate: {
          title: `Legacy post ${slot}`,
          topic: `Historical topic ${slot}`,
          format: "SINGLE_IMAGE",
          objective: "EDUCATION",
        },
      })),
    } });

    expect(plan).not.toBeNull();
    expect(plan?.maxFeedPosts).toBe(3);
    expect(plan?.items).toHaveLength(3);
    expect(plan?.storyPlan).toEqual([]);
  });

  it("adapts companion and standalone Story bundle metadata additively", () => {
    const plan = normalizeWeeklyPlanResponse({ plan: {
      _id: "five-feed-plan",
      status: "APPROVED",
      maximum_feed_posts: 5,
      selected_posts: [{
        candidate_id: "feed-1",
        slot_number: 1,
        status: "NEEDS_REVIEW",
        draft_id: "draft-feed-1",
        bundle_id: "bundle-feed-1",
        bundle_role: "PARENT_FEED",
        candidate: { title: "Feed", topic: "Money", format: "SINGLE_IMAGE", objective: "EDUCATION" },
      }],
      story_plan: [{
        candidate_id: "story-1",
        parent_candidate_id: "feed-1",
        slot_number: 1,
        status: "NEEDS_REVIEW",
        draft_id: "draft-story-1",
        parent_draft_id: "draft-feed-1",
        bundle_id: "bundle-feed-1",
        bundle_role: "COMPANION_STORY",
        candidate: { title: "Companion", topic: "Money", format: "STORY", objective: "EDUCATION" },
      }, {
        candidate_id: "story-6",
        slot_number: 6,
        status: "NEEDS_REVIEW",
        draft_id: "draft-story-6",
        bundle_id: "bundle-saturday",
        bundle_role: "STANDALONE_STORY",
        candidate: { title: "Saturday", topic: "Wellness", format: "STORY", objective: "ENGAGEMENT" },
      }],
    } });

    expect(plan?.storyPlan).toHaveLength(2);
    expect(plan?.storyPlan[0]).toMatchObject({
      bundleId: "bundle-feed-1",
      bundleRole: "COMPANION_STORY",
      parentCandidateId: "feed-1",
      parentDraftId: "draft-feed-1",
    });
    expect(plan?.storyPlan[1]).toMatchObject({
      bundleRole: "STANDALONE_STORY",
      parentCandidateId: "",
    });
  });
});
