const axios = require("axios");
const {
  connectInstagramFromCode,
  getActiveInstagramConnection,
  getGraphVersion,
  getInstagramConnectionSummary,
  markInstagramConnectionError,
  markInstagramPublishSuccess,
} = require("./instagramConnectionService");
const logger = require("../utils/logger");

const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";

function describeInstagramApiError(error) {
  if (!error) return "Instagram publishing failed";
  const graphError = error.response?.data?.error;

  if (graphError?.message) {
    const parts = [graphError.message];
    if (graphError.type) parts.push(`type: ${graphError.type}`);
    if (graphError.code != null) parts.push(`code: ${graphError.code}`);
    if (graphError.error_subcode != null) parts.push(`subcode: ${graphError.error_subcode}`);
    return parts.join(" | ");
  }

  if (error.response?.data?.message) return String(error.response.data.message);
  if (error.message) return String(error.message);
  return "Instagram publishing failed";
}

function withInstagramOperationContext(error, code, details = {}) {
  const operationError = error instanceof Error
    ? error
    : new Error(String(error || "Instagram publishing failed"));
  operationError.code = code || operationError.code || "instagram_publish_failed";
  operationError.details = {
    ...(operationError.details && typeof operationError.details === "object" ? operationError.details : {}),
    ...details,
  };
  return operationError;
}

function isPublicMediaUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) return false;
    if (host.endsWith(".localhost") || host.endsWith(".local")) return false;

    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const parts = ipv4Match.slice(1).map((part) => Number(part));
      if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
      const [first, second] = parts;
      if (first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)) return false;
      if (first === 172 && second >= 16 && second <= 31) return false;
      if (first === 192 && second === 168) return false;
    }

    if (host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphGet(path, params, accessToken) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_BASE}/${getGraphVersion()}/${path.replace(/^\/+/, "")}`, {
    params: {
      ...params,
      access_token: accessToken,
    },
    timeout: 25000,
  });
  return response.data;
}

async function graphPost(path, params, accessToken) {
  const response = await axios.post(
    `${INSTAGRAM_GRAPH_BASE}/${getGraphVersion()}/${path.replace(/^\/+/, "")}`,
    new URLSearchParams({
      ...Object.fromEntries(Object.entries(params || {}).map(([key, value]) => [key, value == null ? "" : String(value)])),
      access_token: accessToken,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 30000,
    }
  );
  return response.data;
}

function assertPublishableUrls(assetUrls) {
  if (!Array.isArray(assetUrls) || !assetUrls.length) {
    throw new Error("No Instagram creative assets are available for publishing");
  }

  const invalid = assetUrls.filter((url) => !isPublicMediaUrl(url));
  if (invalid.length) {
    throw new Error("Instagram publishing requires publicly reachable HTTPS media URLs. Check SERVER_URL or PUBLIC_MEDIA_BASE_URL.");
  }
}

async function fetchInstagramAccountInfo() {
  const connection = await getActiveInstagramConnection();
  return connection;
}

async function exchangeAuthCodeForToken({ code, state }) {
  return connectInstagramFromCode({ code, state });
}

async function getContentPublishingLimit(userAccessToken, igUserId) {
  try {
    return await graphGet(`${igUserId}/content_publishing_limit`, {}, userAccessToken);
  } catch (_error) {
    return null;
  }
}

async function getContainerStatus(containerId, userAccessToken) {
  return graphGet(containerId, { fields: "id,status,status_code" }, userAccessToken);
}

async function pollPublishStatus(containerId, userAccessToken, {
  maxAttempts = 10,
  delayMs = 3000,
} = {}) {
  let lastStatus = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let status;
    try {
      status = await getContainerStatus(containerId, userAccessToken);
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_container_status_unavailable", {
        container_id: containerId,
        container_failure_terminal: false,
      });
    }
    lastStatus = status;
    const code = String(status?.status_code || "").toUpperCase();

    if (code === "FINISHED" || code === "PUBLISHED") return status;
    if (code === "ERROR" || code === "EXPIRED") {
      throw withInstagramOperationContext(
        new Error(status?.status || `Instagram media container ${containerId} failed with ${code}`),
        "instagram_container_failed",
        {
          container_id: containerId,
          container_status: code,
          container_failure_terminal: true,
        }
      );
    }

    if (attempt < maxAttempts - 1) await sleep(delayMs);
  }

  throw withInstagramOperationContext(
    new Error(`Instagram media container ${containerId} did not finish processing in time`),
    "instagram_container_pending",
    {
      container_id: containerId,
      container_status: lastStatus?.status_code || null,
      container_failure_terminal: false,
    }
  );
}

async function createImageContainer(igUserId, userAccessToken, { imageUrl, caption, isCarouselItem = false, mediaType = null }) {
  const payload = {
    image_url: imageUrl,
    ...(caption ? { caption } : {}),
    ...(isCarouselItem ? { is_carousel_item: "true" } : {}),
    ...(mediaType ? { media_type: String(mediaType).toUpperCase() } : {}),
  };

  return graphPost(`${igUserId}/media`, payload, userAccessToken);
}

async function createVideoContainer(igUserId, userAccessToken, {
  videoUrl,
  caption,
  mediaType = "REELS",
  shareToFeed = null,
  coverUrl = null,
  thumbOffset = null,
}) {
  const normalizedType = String(mediaType || "REELS").toUpperCase();
  if (!["REELS", "STORIES"].includes(normalizedType)) {
    throw new Error(`Unsupported Instagram video container type ${mediaType}`);
  }
  return graphPost(`${igUserId}/media`, {
    media_type: normalizedType,
    video_url: videoUrl,
    ...(caption && normalizedType !== "STORIES" ? { caption } : {}),
    ...(shareToFeed != null && normalizedType === "REELS" ? { share_to_feed: shareToFeed ? "true" : "false" } : {}),
    ...(coverUrl && normalizedType === "REELS" ? { cover_url: coverUrl } : {}),
    ...(thumbOffset != null && normalizedType === "REELS" ? { thumb_offset: String(thumbOffset) } : {}),
  }, userAccessToken);
}

async function createCarouselContainer(igUserId, userAccessToken, { children, caption }) {
  return graphPost(`${igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  }, userAccessToken);
}

async function publishContainer(igUserId, userAccessToken, creationId) {
  return graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
  }, userAccessToken);
}

function assertPublishedMediaIdentifier(published, details = {}) {
  const mediaId = String(published?.id || "").trim();
  if (!mediaId) {
    throw withInstagramOperationContext(
      new Error("Meta did not return a published media identifier"),
      "instagram_publish_identifier_missing",
      {
        instagram_publish_stage: "media_publish",
        instagram_outcome_uncertain: true,
        ...details,
      },
    );
  }
  return mediaId;
}

async function getMediaInfo(mediaId, userAccessToken) {
  return graphGet(mediaId, {
    fields: "id,permalink,media_type,media_product_type,caption,timestamp",
  }, userAccessToken);
}

function mediaEnrichmentWarning(error) {
  const providerStatus = Number(error?.response?.status || error?.status || error?.statusCode || 0) || null;
  const rawProviderCode = error?.response?.data?.error?.code ?? error?.code ?? null;
  const normalizedProviderCode = rawProviderCode == null
    ? null
    : String(rawProviderCode).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  const providerCode = normalizedProviderCode
    && !/(?:access|refresh)[_-]?token|secret|password|authorization|api[_-]?key/i.test(normalizedProviderCode)
    ? normalizedProviderCode
    : null;
  return {
    code: "instagram_media_enrichment_failed",
    message: "Instagram published the media, but the follow-up media/permalink lookup failed. Do not republish; retry enrichment for the stored Meta media ID.",
    provider_status: providerStatus,
    provider_code: providerCode,
    is_retriable: !providerStatus || [408, 409, 425, 429, 500, 502, 503, 504].includes(providerStatus),
  };
}

async function enrichPublishedMediaInfo(mediaId, userAccessToken) {
  try {
    return { mediaInfo: await getMediaInfo(mediaId, userAccessToken), warning: null };
  } catch (error) {
    return { mediaInfo: { id: mediaId }, warning: mediaEnrichmentWarning(error) };
  }
}

async function publishSingleImage({ connection, assetUrls, caption, contentType = "single_image", resumeState = {}, onProgress = null }) {
  const imageUrl = assetUrls[0];
  const isStory = String(contentType).toLowerCase() === "story";
  if (isStory && String(connection.account_type || "").toUpperCase() !== "BUSINESS") {
    const error = new Error("Instagram Story publishing through the API requires a Business account");
    error.code = "instagram_story_business_account_required";
    throw error;
  }
  const creation = resumeState.creation_id
    ? { id: resumeState.creation_id }
    : await createImageContainer(connection.instagram_user_id, connection.user_access_token, {
      imageUrl,
      caption: isStory ? null : caption,
      mediaType: isStory ? "STORIES" : null,
    });

  if (!resumeState.creation_id && onProgress) {
    await onProgress({ status: "container_created", creation_id: creation.id, child_creation_ids: [] });
  }

  try {
    await pollPublishStatus(creation.id, connection.user_access_token);
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_container_failed", {
      instagram_publish_stage: "single_container",
      creation_id: creation.id,
    });
  }
  if (resumeState.media_id) {
    const enrichment = await enrichPublishedMediaInfo(resumeState.media_id, connection.user_access_token);
    const mediaInfo = enrichment.mediaInfo;
    return {
      content_type: isStory ? "story" : "single_image",
      creation_id: creation.id,
      media_id: resumeState.media_id,
      permalink: resumeState.permalink || mediaInfo?.permalink || null,
      media_info: mediaInfo,
      enrichment_warning: enrichment.warning,
      resumed: true,
    };
  }
  if (onProgress) {
    try {
      await onProgress({ status: "publishing", creation_id: creation.id, child_creation_ids: [] });
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
        instagram_publish_stage: "pre_media_publish",
        instagram_outcome_uncertain: false,
        creation_id: creation.id,
        child_creation_ids: [],
      });
    }
  }
  let published;
  try {
    published = await publishContainer(connection.instagram_user_id, connection.user_access_token, creation.id);
  } catch (error) {
    throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
      instagram_publish_stage: "media_publish",
      instagram_outcome_uncertain: true,
      creation_id: creation.id,
      child_creation_ids: [],
    });
  }
  const mediaId = assertPublishedMediaIdentifier(published, {
    creation_id: creation.id,
    child_creation_ids: [],
  });
  const enrichment = await enrichPublishedMediaInfo(mediaId, connection.user_access_token);
  const mediaInfo = enrichment.mediaInfo;
  if (onProgress) {
    await onProgress({
      status: "published",
      creation_id: creation.id,
      child_creation_ids: [],
      media_id: mediaId,
      permalink: mediaInfo?.permalink || null,
      enrichment_warning: enrichment.warning,
    }).catch((error) => {
      logger.error({ err: error, instagramMediaId: mediaId }, "Instagram media published but final progress persistence failed");
    });
  }

  return {
    content_type: isStory ? "story" : "single_image",
    creation_id: creation.id,
    media_id: mediaId,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
    enrichment_warning: enrichment.warning,
  };
}

async function publishCarousel({ connection, assetUrls, caption, resumeState = {}, onProgress = null }) {
  const childIds = Array.isArray(resumeState.child_creation_ids) ? [...resumeState.child_creation_ids] : [];

  if (childIds.length > assetUrls.length) {
    throw withInstagramOperationContext(
      new Error("Stored Instagram carousel children do not match the current slide count"),
      "instagram_carousel_checkpoint_invalid",
      { instagram_publish_stage: "child_container", child_creation_ids: childIds }
    );
  }

  for (let index = 0; index < childIds.length; index += 1) {
    try {
      await pollPublishStatus(childIds[index], connection.user_access_token, { maxAttempts: 6, delayMs: 2500 });
    } catch (error) {
      throw withInstagramOperationContext(error, error.code || "instagram_child_container_failed", {
        instagram_publish_stage: "child_container",
        failed_child_index: index,
        creation_id: resumeState.creation_id || null,
        child_creation_ids: childIds,
      });
    }
  }

  for (let index = childIds.length; index < Math.min(assetUrls.length, 10); index += 1) {
    try {
      const child = await createImageContainer(connection.instagram_user_id, connection.user_access_token, {
        imageUrl: assetUrls[index],
        isCarouselItem: true,
      });
      childIds.push(child.id);
      if (onProgress) await onProgress({ status: "container_created", creation_id: resumeState.creation_id || null, child_creation_ids: childIds });
      await pollPublishStatus(child.id, connection.user_access_token, { maxAttempts: 6, delayMs: 2500 });
    } catch (error) {
      throw withInstagramOperationContext(error, error.code || "instagram_child_container_failed", {
        instagram_publish_stage: "child_container",
        failed_child_index: index,
        creation_id: resumeState.creation_id || null,
        child_creation_ids: childIds,
      });
    }
  }

  let parent;
  try {
    parent = resumeState.creation_id
      ? { id: resumeState.creation_id }
      : await createCarouselContainer(connection.instagram_user_id, connection.user_access_token, { children: childIds, caption });
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_parent_container_failed", {
      instagram_publish_stage: "parent_container",
      creation_id: null,
      child_creation_ids: childIds,
    });
  }

  if (!resumeState.creation_id && onProgress) {
    await onProgress({ status: "container_created", creation_id: parent.id, child_creation_ids: childIds });
  }

  try {
    await pollPublishStatus(parent.id, connection.user_access_token, { maxAttempts: 8, delayMs: 3000 });
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_parent_container_failed", {
      instagram_publish_stage: "parent_container",
      creation_id: parent.id,
      child_creation_ids: childIds,
    });
  }
  if (resumeState.media_id) {
    const enrichment = await enrichPublishedMediaInfo(resumeState.media_id, connection.user_access_token);
    const mediaInfo = enrichment.mediaInfo;
    return {
      content_type: "carousel",
      creation_id: parent.id,
      child_creation_ids: childIds,
      media_id: resumeState.media_id,
      permalink: resumeState.permalink || mediaInfo?.permalink || null,
      media_info: mediaInfo,
      enrichment_warning: enrichment.warning,
      resumed: true,
    };
  }
  if (onProgress) {
    try {
      await onProgress({ status: "publishing", creation_id: parent.id, child_creation_ids: childIds });
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
        instagram_publish_stage: "pre_media_publish",
        instagram_outcome_uncertain: false,
        creation_id: parent.id,
        child_creation_ids: childIds,
      });
    }
  }
  let published;
  try {
    published = await publishContainer(connection.instagram_user_id, connection.user_access_token, parent.id);
  } catch (error) {
    throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
      instagram_publish_stage: "media_publish",
      instagram_outcome_uncertain: true,
      creation_id: parent.id,
      child_creation_ids: childIds,
    });
  }
  const mediaId = assertPublishedMediaIdentifier(published, {
    creation_id: parent.id,
    child_creation_ids: childIds,
  });
  const enrichment = await enrichPublishedMediaInfo(mediaId, connection.user_access_token);
  const mediaInfo = enrichment.mediaInfo;
  if (onProgress) {
    await onProgress({
      status: "published",
      creation_id: parent.id,
      child_creation_ids: childIds,
      media_id: mediaId,
      permalink: mediaInfo?.permalink || null,
      enrichment_warning: enrichment.warning,
    }).catch((error) => {
      logger.error({ err: error, instagramMediaId: mediaId }, "Instagram carousel published but final progress persistence failed");
    });
  }

  return {
    content_type: "carousel",
    creation_id: parent.id,
    child_creation_ids: childIds,
    media_id: mediaId,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
    enrichment_warning: enrichment.warning,
  };
}

async function publishVideo({ connection, assetUrls, caption, contentType = "reel", resumeState = {}, onProgress = null }) {
  const normalizedType = String(contentType || "reel").toLowerCase();
  const isStory = normalizedType === "story";
  if (isStory && String(connection.account_type || "").toUpperCase() !== "BUSINESS") {
    const error = new Error("Instagram Story publishing through the API requires a Business account");
    error.code = "instagram_story_business_account_required";
    throw error;
  }
  const creation = resumeState.creation_id
    ? { id: resumeState.creation_id }
    : await createVideoContainer(connection.instagram_user_id, connection.user_access_token, {
      videoUrl: assetUrls[0],
      caption,
      mediaType: isStory ? "STORIES" : "REELS",
      shareToFeed: !isStory,
      coverUrl: resumeState.cover_url || null,
      thumbOffset: resumeState.thumb_offset ?? null,
    });
  if (!resumeState.creation_id && onProgress) {
    await onProgress({ status: "container_created", creation_id: creation.id, child_creation_ids: [] });
  }
  try {
    await pollPublishStatus(creation.id, connection.user_access_token, {
      maxAttempts: Math.max(Number(process.env.INSTAGRAM_VIDEO_STATUS_MAX_ATTEMPTS || 20), 1),
      delayMs: Math.max(Number(process.env.INSTAGRAM_VIDEO_STATUS_DELAY_MS || 15000), 1000),
    });
  } catch (error) {
    throw withInstagramOperationContext(error, error.code || "instagram_video_container_failed", {
      instagram_publish_stage: "video_container",
      creation_id: creation.id,
      content_type: normalizedType,
    });
  }
  if (resumeState.media_id) {
    const enrichment = await enrichPublishedMediaInfo(resumeState.media_id, connection.user_access_token);
    const mediaInfo = enrichment.mediaInfo;
    return {
      content_type: normalizedType,
      creation_id: creation.id,
      media_id: resumeState.media_id,
      permalink: resumeState.permalink || mediaInfo?.permalink || null,
      media_info: mediaInfo,
      enrichment_warning: enrichment.warning,
      resumed: true,
    };
  }
  if (onProgress) {
    try {
      await onProgress({ status: "publishing", creation_id: creation.id, child_creation_ids: [] });
    } catch (error) {
      throw withInstagramOperationContext(error, "instagram_publish_checkpoint_failed", {
        instagram_publish_stage: "pre_media_publish",
        instagram_outcome_uncertain: false,
        creation_id: creation.id,
      });
    }
  }
  let published;
  try {
    published = await publishContainer(connection.instagram_user_id, connection.user_access_token, creation.id);
  } catch (error) {
    throw withInstagramOperationContext(error, "instagram_publish_outcome_uncertain", {
      instagram_publish_stage: "media_publish",
      instagram_outcome_uncertain: true,
      creation_id: creation.id,
      content_type: normalizedType,
    });
  }
  const mediaId = assertPublishedMediaIdentifier(published, {
    creation_id: creation.id,
    content_type: normalizedType,
  });
  const enrichment = await enrichPublishedMediaInfo(mediaId, connection.user_access_token);
  const mediaInfo = enrichment.mediaInfo;
  if (onProgress) {
    await onProgress({
      status: "published",
      creation_id: creation.id,
      child_creation_ids: [],
      media_id: mediaId,
      permalink: mediaInfo?.permalink || null,
      enrichment_warning: enrichment.warning,
    }).catch((error) => logger.error({ err: error, instagramMediaId: mediaId }, "Instagram video published but final progress persistence failed"));
  }
  return {
    content_type: normalizedType,
    creation_id: creation.id,
    media_id: mediaId,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
    enrichment_warning: enrichment.warning,
  };
}

async function publishInstagramDraft({ contentType, assetUrls, assetMimeTypes = [], caption, resumeState = {}, onProgress = null, dependencies = {} }) {
  const connection = await (dependencies.getActiveInstagramConnection || getActiveInstagramConnection)({ withTokens: true, refreshIfNeeded: true });
  assertPublishableUrls(assetUrls);

  const publishingLimit = await (dependencies.getContentPublishingLimit || getContentPublishingLimit)(connection.user_access_token, connection.instagram_user_id);
  const quotaUsage = Number(
    publishingLimit?.data?.[0]?.quota_usage
    || publishingLimit?.quota_usage
    || 0
  );
  const quotaTotal = Number(
    publishingLimit?.data?.[0]?.quota_total
    || publishingLimit?.data?.[0]?.config?.quota_total
    || publishingLimit?.quota_total
    || 0
  );

  if (quotaTotal > 0 && quotaUsage >= quotaTotal) {
    const error = new Error("Instagram API publishing limit reached for the last 24 hours");
    error.code = "instagram_publishing_quota_reached";
    error.details = { provider: "META", quota_usage: quotaUsage, quota_total: quotaTotal };
    throw error;
  }

  let result;
  try {
    if (contentType === "carousel") {
      result = await (dependencies.publishCarousel || publishCarousel)({ connection, assetUrls, caption, resumeState, onProgress });
    } else if (["reel", "video_feed"].includes(contentType) || (contentType === "story" && String(assetMimeTypes[0] || "").startsWith("video/"))) {
      result = await (dependencies.publishVideo || publishVideo)({ connection, assetUrls, caption, contentType, resumeState, onProgress });
    } else {
      result = await (dependencies.publishSingleImage || publishSingleImage)({ connection, assetUrls, caption, contentType, resumeState, onProgress });
    }
    assertPublishedMediaIdentifier({ id: result?.media_id }, {
      creation_id: result?.creation_id || null,
      child_creation_ids: result?.child_creation_ids || [],
      defensive_result_validation: true,
    });
  } catch (error) {
    await (dependencies.markInstagramConnectionError || markInstagramConnectionError)(describeInstagramApiError(error));
    throw error;
  }

  await (dependencies.markInstagramPublishSuccess || markInstagramPublishSuccess)().catch((error) => {
    logger.error({ err: error, instagramMediaId: result?.media_id || null }, "Instagram publish succeeded but connection bookkeeping failed");
  });

  return {
    ...result,
    publishing_limit: publishingLimit || null,
    connection: {
      instagram_user_id: connection.instagram_user_id,
      instagram_username: connection.instagram_username,
      account_type: connection.account_type || null,
      login_type: connection.login_type || "instagram_business_login",
    },
  };
}

module.exports = {
  assertPublishedMediaIdentifier,
  createVideoContainer,
  exchangeAuthCodeForToken,
  fetchInstagramAccountInfo,
  getContentPublishingLimit,
  getContainerStatus,
  enrichPublishedMediaInfo,
  getMediaInfo,
  getInstagramConnectionSummary,
  isPublicMediaUrl,
  pollPublishStatus,
  publishCarousel,
  publishContainer,
  publishInstagramDraft,
  publishSingleImage,
  publishVideo,
};
