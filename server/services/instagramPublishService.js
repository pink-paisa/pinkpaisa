const axios = require("axios");
const {
  connectInstagramFromCode,
  getActiveInstagramConnection,
  getGraphVersion,
  getInstagramConnectionSummary,
  markInstagramConnectionError,
  markInstagramPublishSuccess,
} = require("./instagramConnectionService");

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

function isPublicMediaUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "0.0.0.0"].includes(host);
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
    throw new Error("Instagram publishing requires publicly reachable HTTPS image URLs. Check SERVER_URL or PUBLIC_MEDIA_BASE_URL.");
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
    const status = await getContainerStatus(containerId, userAccessToken).catch(() => null);
    lastStatus = status;
    const code = String(status?.status_code || "").toUpperCase();

    if (!code || code === "FINISHED" || code === "PUBLISHED") return status;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(status?.status || `Instagram media container ${containerId} failed with ${code}`);
    }

    await sleep(delayMs);
  }

  return lastStatus;
}

async function createImageContainer(igUserId, userAccessToken, { imageUrl, caption, isCarouselItem = false }) {
  const payload = {
    image_url: imageUrl,
    ...(caption ? { caption } : {}),
    ...(isCarouselItem ? { is_carousel_item: "true" } : {}),
  };

  return graphPost(`${igUserId}/media`, payload, userAccessToken);
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

async function getMediaInfo(mediaId, userAccessToken) {
  return graphGet(mediaId, {
    fields: "id,permalink,media_type,media_product_type,caption,timestamp",
  }, userAccessToken);
}

async function publishSingleImage({ connection, assetUrls, caption }) {
  const imageUrl = assetUrls[0];
  const creation = await createImageContainer(connection.instagram_user_id, connection.user_access_token, {
    imageUrl,
    caption,
  });

  await pollPublishStatus(creation.id, connection.user_access_token);
  const published = await publishContainer(connection.instagram_user_id, connection.user_access_token, creation.id);
  const mediaInfo = await getMediaInfo(published.id, connection.user_access_token).catch(() => ({ id: published.id }));

  return {
    content_type: "single_image",
    creation_id: creation.id,
    media_id: published.id,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
  };
}

async function publishCarousel({ connection, assetUrls, caption }) {
  const childIds = [];

  for (const assetUrl of assetUrls.slice(0, 10)) {
    const child = await createImageContainer(connection.instagram_user_id, connection.user_access_token, {
      imageUrl: assetUrl,
      isCarouselItem: true,
    });
    childIds.push(child.id);
    await pollPublishStatus(child.id, connection.user_access_token, { maxAttempts: 6, delayMs: 2500 }).catch(() => null);
  }

  const parent = await createCarouselContainer(connection.instagram_user_id, connection.user_access_token, {
    children: childIds,
    caption,
  });

  await pollPublishStatus(parent.id, connection.user_access_token, { maxAttempts: 8, delayMs: 3000 }).catch(() => null);
  const published = await publishContainer(connection.instagram_user_id, connection.user_access_token, parent.id);
  const mediaInfo = await getMediaInfo(published.id, connection.user_access_token).catch(() => ({ id: published.id }));

  return {
    content_type: "carousel",
    creation_id: parent.id,
    child_creation_ids: childIds,
    media_id: published.id,
    permalink: mediaInfo?.permalink || null,
    media_info: mediaInfo,
  };
}

async function publishInstagramDraft({ contentType, assetUrls, caption }) {
  const connection = await getActiveInstagramConnection({ withTokens: true, refreshIfNeeded: true });
  assertPublishableUrls(assetUrls);

  const publishingLimit = await getContentPublishingLimit(connection.user_access_token, connection.instagram_user_id);
  const quotaUsage = Number(
    publishingLimit?.data?.[0]?.quota_usage
    || publishingLimit?.quota_usage
    || 0
  );

  if (quotaUsage >= 100) {
    throw new Error("Instagram API publishing limit reached for the last 24 hours");
  }

  try {
    const result = contentType === "carousel"
      ? await publishCarousel({ connection, assetUrls, caption })
      : await publishSingleImage({ connection, assetUrls, caption });

    await markInstagramPublishSuccess();

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
  } catch (error) {
    await markInstagramConnectionError(describeInstagramApiError(error));
    throw error;
  }
}

module.exports = {
  exchangeAuthCodeForToken,
  fetchInstagramAccountInfo,
  getContentPublishingLimit,
  getContainerStatus,
  getMediaInfo,
  getInstagramConnectionSummary,
  pollPublishStatus,
  publishCarousel,
  publishContainer,
  publishInstagramDraft,
  publishSingleImage,
};
