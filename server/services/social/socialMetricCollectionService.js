const crypto = require("crypto");
const SocialMetricSnapshot = require("../../models/SocialMetricSnapshot");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPublication = require("../../models/SocialPublication");
const {
  persistSocialAutomationFailure,
  _private: { safeErrorCode, safeFailureText },
} = require("./socialAutomationFailureService");

const DEFAULT_SNAPSHOT_WINDOWS_HOURS = Object.freeze([1, 24, 72, 168, 672]);

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function configuredSnapshotWindows(settings = {}) {
  const values = settings.analytics?.snapshot_intervals_hours || settings.weekly_planning?.analytics_intervals_hours || DEFAULT_SNAPSHOT_WINDOWS_HOURS;
  return [...new Set((Array.isArray(values) ? values : DEFAULT_SNAPSHOT_WINDOWS_HOURS)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 24 * 60))]
    .sort((left, right) => left - right)
    .slice(0, 10);
}

function metricValue(row) {
  const direct = row?.value;
  const nested = Array.isArray(row?.values) ? row.values[0]?.value : null;
  const value = direct ?? nested;
  if (typeof value === "object" && value !== null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeInstagramInsights(payload = {}) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const source = Object.fromEntries(rows.map((row) => [String(row.name || row.metric || "").toLowerCase(), metricValue(row)]));
  const first = (...names) => {
    for (const name of names) if (source[name] != null) return source[name];
    return null;
  };
  const metrics = {
    reach: first("reach"),
    non_follower_reach: first("non_follower_reach", "non_followers_reach"),
    impressions: first("impressions"),
    views: first("views", "plays"),
    likes: first("likes", "like_count"),
    comments: first("comments", "comments_count"),
    saves: first("saved", "saves"),
    shares: first("shares"),
    total_interactions: first("total_interactions"),
    video_views: first("video_views", "plays", "views"),
    profile_visits: first("profile_visits", "profile_activity"),
    follows: first("follows", "follows_and_unfollows"),
  };
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value != null));
}

async function persistMetricCollectionFailure({ publication, windowHours, snapshotKey, now, error, dependencies }) {
  const failure = {
    publication_id: String(publication._id),
    window_hours: windowHours,
    error: safeFailureText(error?.message || error, 500),
    code: safeErrorCode(error?.code, "INSTAGRAM_METRIC_COLLECTION_FAILED"),
  };
  try {
    const persisted = await persistSocialAutomationFailure({
      now,
      provider: "INSTAGRAM",
      operation: "INSTAGRAM_METRIC_COLLECTION_FAILED",
      actionKey: `social-metric-collection-failure:${publication._id}:${windowHours}h`,
      actionType: "PERMISSION_REVIEW",
      priority: "HIGH",
      title: "Resolve failed Instagram metric collection",
      description: `Instagram metrics could not be collected for the ${windowHours}-hour window of publication ${publication._id}: ${failure.error}`,
      instructions: [
        "Open Connections and verify the Instagram token, media-insights permissions, account linkage, and recorded provider error.",
        "After fixing the connection, refresh Published & Analytics and confirm that this historical snapshot is captured before completing the action.",
      ],
      entityType: "PUBLICATION",
      entityId: publication._id,
      draftId: publication.draft_id || null,
      publicationId: publication._id,
      externalReferenceId: `${publication._id}:${windowHours}h`,
      error: { message: failure.error, code: failure.code },
      metadata: { window_hours: windowHours, snapshot_key: snapshotKey },
      dependencies,
    });
    return { ...failure, ...persisted };
  } catch (persistenceError) {
    return {
      ...failure,
      durability: "PERSISTENCE_FAILED",
      persistence_error: safeFailureText(persistenceError?.message || persistenceError, 500),
      persistence_code: safeErrorCode(persistenceError?.code, "SOCIAL_FAILURE_PERSISTENCE_FAILED"),
    };
  }
}

async function collectDueInstagramMetricSnapshots({ now = new Date(), settings = {}, limit = 20, dependencies = {} } = {}) {
  const PublicationModel = dependencies.SocialPublication || SocialPublication;
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const SnapshotModel = dependencies.SocialMetricSnapshot || SocialMetricSnapshot;
  const instagram = dependencies.instagramGrowthService || require("../instagramGrowthService");
  const windows = configuredSnapshotWindows(settings);
  const oldest = new Date(now.getTime() - (Math.max(...windows) + 24) * 60 * 60 * 1000);
  const publications = await PublicationModel.find({
    status: "PUBLISHED",
    external_publication_id: { $nin: [null, ""] },
    published_at: { $gte: oldest, $lte: now },
  }).sort({ published_at: 1 }).limit(Math.min(Math.max(Number(limit || 20), 1), 100));
  let collected = 0;
  let skipped = 0;
  const failures = [];
  for (const publication of publications) {
    const publishedAt = new Date(publication.published_at);
    const ageHours = (now.getTime() - publishedAt.getTime()) / (60 * 60 * 1000);
    for (const windowHours of windows) {
      if (ageHours < windowHours) continue;
      const snapshotKey = `social-metric:${publication._id}:instagram:${windowHours}h`;
      if (await SnapshotModel.exists({ snapshot_key: snapshotKey })) {
        skipped += 1;
        continue;
      }
      try {
        const payload = await instagram.getMediaInsights({ mediaId: publication.external_publication_id, dependencies });
        const metrics = normalizeInstagramInsights(payload);
        if (!Object.keys(metrics).length) {
          const error = new Error("Meta returned no available metrics");
          error.code = "instagram_metrics_unavailable";
          failures.push(await persistMetricCollectionFailure({ publication, windowHours, snapshotKey, now, error, dependencies }));
          continue;
        }
        const draft = await DraftModel.findById(publication.draft_id).select("current_package generation_date").lean();
        const utm = draft?.current_package?.primaryRecommendation?.utmParameters || {};
        await SnapshotModel.create({
          snapshot_key: snapshotKey,
          draft_id: publication.draft_id,
          publication_id: publication._id,
          external_publication_id: publication.external_publication_id,
          source: "INSTAGRAM_GRAPH",
          retrieval_status: "COMPLETE",
          captured_at: now,
          attribution_window_hours: windowHours,
          published_at: publishedAt,
          metrics,
          utm_parameters: {
            source: utm.source || "instagram",
            medium: utm.medium || "organic_social",
            campaign: utm.campaign || null,
            content: utm.content || null,
          },
          provenance_note: `Official Meta media insights captured for the ${windowHours}-hour historical window; unavailable metrics were omitted, not written as zero.`,
          raw_response_hash: sha256(payload),
        });
        collected += 1;
      } catch (error) {
        if (error?.code === 11000) {
          skipped += 1;
          continue;
        }
        failures.push(await persistMetricCollectionFailure({ publication, windowHours, snapshotKey, now, error, dependencies }));
      }
    }
  }
  return { collected, skipped, failures, windows };
}

module.exports = {
  DEFAULT_SNAPSHOT_WINDOWS_HOURS,
  collectDueInstagramMetricSnapshots,
  configuredSnapshotWindows,
  normalizeInstagramInsights,
  _private: { persistMetricCollectionFailure },
};
