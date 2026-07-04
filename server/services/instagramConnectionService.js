const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const InstagramConnection = require("../models/InstagramConnection");
const { requireEnv } = require("../utils/authConfig");

const DEFAULT_GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || "v23.0";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";
const INSTAGRAM_API_BASE = "https://api.instagram.com";
const INSTAGRAM_AUTH_BASE = String(process.env.INSTAGRAM_OAUTH_BASE_URL || "https://www.instagram.com").replace(/\/+$/, "");
const ACTIVE_PROVIDERS = ["instagram_login", "facebook_login"];
const DEFAULT_SHORT_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_WINDOW_MS = 12 * 60 * 60 * 1000;

function getGraphVersion() {
  return String(process.env.INSTAGRAM_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION).trim();
}

function trimValue(value) {
  return String(value || "").trim();
}

function getOauthSecret() {
  return trimValue(process.env.INSTAGRAM_OAUTH_STATE_SECRET) || requireEnv("JWT_SECRET");
}

function getEncryptionKey() {
  const secret = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;
  if (!secret) return null;
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function assertTokenEncryptionConfigured() {
  if (isProduction() && !getEncryptionKey()) {
    throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY is required before storing or refreshing Instagram tokens in production.");
  }
}

function encryptToken(value) {
  const token = trimValue(value);
  if (!token) return { value: null, mode: "plain" };

  const key = getEncryptionKey();
  if (!key && isProduction()) {
    throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY is required before storing Instagram tokens in production.");
  }
  if (!key) return { value: token, mode: "plain" };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    value: `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`,
    mode: "encrypted",
  };
}

function decryptToken(value, mode = "plain") {
  if (!value) return null;
  if (mode !== "encrypted") {
    if (isProduction()) {
      throw new Error("Instagram token is not encrypted. Reconnect the Instagram account.");
    }
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY is required to read Instagram tokens.");
  }

  const [, ivHex, authTagHex, dataHex] = String(value).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function assertInstagramEnv() {
  const required = ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI"];
  const missing = required.filter((key) => !trimValue(process.env[key]));
  if (missing.length) {
    throw new Error(`Missing Instagram config: ${missing.join(", ")}`);
  }
}

function getScopes() {
  const envScopes = trimValue(process.env.INSTAGRAM_REQUIRED_SCOPES)
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (envScopes.length) return [...new Set(envScopes)];

  const scopes = [
    "instagram_business_basic",
    "instagram_business_content_publish",
  ];

  if (String(process.env.INSTAGRAM_ENABLE_MANAGE_COMMENTS || "false") === "true") {
    scopes.push("instagram_business_manage_comments");
  }

  if (String(process.env.INSTAGRAM_ENABLE_MANAGE_MESSAGES || "false") === "true") {
    scopes.push("instagram_business_manage_messages");
  }

  return scopes;
}

function buildOauthState() {
  return jwt.sign(
    {
      purpose: "instagram-connect",
      issued_at: Date.now(),
    },
    getOauthSecret(),
    { expiresIn: "15m" }
  );
}

function verifyOauthState(state) {
  const decoded = jwt.verify(String(state || ""), getOauthSecret());
  if (decoded?.purpose !== "instagram-connect") throw new Error("Invalid Instagram OAuth state");
  return decoded;
}

function parseExpiry(expiresInSeconds, fallbackSeconds = 0) {
  const seconds = Number(expiresInSeconds || fallbackSeconds || 0);
  return seconds > 0 ? new Date(Date.now() + (seconds * 1000)) : null;
}

function normaliseProfilePayload(payload) {
  const source = Array.isArray(payload?.data) ? (payload.data[0] || {}) : (payload || {});
  const asNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  return {
    app_scoped_id: trimValue(source.id),
    instagram_user_id: trimValue(source.user_id || source.id),
    username: trimValue(source.username),
    name: trimValue(source.name),
    account_type: trimValue(source.account_type),
    profile_picture_url: trimValue(source.profile_picture_url),
    followers_count: asNumber(source.followers_count),
    follows_count: asNumber(source.follows_count),
    media_count: asNumber(source.media_count),
    raw: source,
  };
}

async function exchangeCodeForUserToken(code) {
  const response = await axios.post(
    `${INSTAGRAM_API_BASE}/oauth/access_token`,
    new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 20000,
    }
  );
  return response.data;
}

async function exchangeForLongLivedUserToken(userAccessToken) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_BASE}/access_token`, {
    params: {
      grant_type: "ig_exchange_token",
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      access_token: userAccessToken,
    },
    timeout: 20000,
  });
  return response.data;
}

async function refreshLongLivedUserToken(userAccessToken) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_BASE}/refresh_access_token`, {
    params: {
      grant_type: "ig_refresh_token",
      access_token: userAccessToken,
    },
    timeout: 20000,
  });
  return response.data;
}

async function getInstagramProfile(userAccessToken) {
  const version = getGraphVersion();
  const fullFields = "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count";
  const minimalFields = "user_id,username,name,account_type,profile_picture_url";

  try {
    const response = await axios.get(`${INSTAGRAM_GRAPH_BASE}/${version}/me`, {
      params: {
        fields: fullFields,
        access_token: userAccessToken,
      },
      timeout: 20000,
    });
    return normaliseProfilePayload(response.data);
  } catch (_error) {
    const response = await axios.get(`${INSTAGRAM_GRAPH_BASE}/${version}/me`, {
      params: {
        fields: minimalFields,
        access_token: userAccessToken,
      },
      timeout: 20000,
    });
    return normaliseProfilePayload(response.data);
  }
}

function buildAuthUrl(stateToken) {
  assertInstagramEnv();
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    response_type: "code",
    scope: getScopes().join(","),
    state: stateToken,
  });
  return `${INSTAGRAM_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

async function getConnectionRecord() {
  return InstagramConnection.findOne({ provider: { $in: ACTIVE_PROVIDERS } }).sort({ updated_at: -1, created_at: -1 });
}

async function saveConnection(existing, updates) {
  if (existing) {
    Object.assign(existing, updates);
    await existing.save();
    return existing;
  }
  return InstagramConnection.create({
    provider: "instagram_login",
    connection_label: "Pink Paisa Instagram",
    ...updates,
  });
}

async function ensureConnectionTokenEncryption(connection) {
  if (!connection || !connection.user_access_token_encrypted) return connection;
  if (connection.token_storage_mode === "encrypted") return connection;

  const key = getEncryptionKey();
  if (!key) {
    assertTokenEncryptionConfigured();
    return connection;
  }

  const encryptedToken = encryptToken(connection.user_access_token_encrypted);
  return saveConnection(connection, {
    user_access_token_encrypted: encryptedToken.value,
    token_storage_mode: encryptedToken.mode,
    last_error: null,
  });
}

function serialiseConnection(connection) {
  if (!connection) {
    return {
      status: "disconnected",
      provider: "instagram_login",
      login_type: "instagram_business_login",
      is_connected: false,
    };
  }

  return {
    id: String(connection._id),
    provider: "instagram_login",
    login_type: connection.login_type || "instagram_business_login",
    status: connection.status,
    is_connected: connection.status === "connected",
    account_type: connection.account_type || connection.metadata_json?.profile?.account_type || null,
    facebook_page_id: connection.facebook_page_id || null,
    facebook_page_name: connection.facebook_page_name || null,
    instagram_user_id: connection.instagram_user_id || null,
    instagram_username: connection.instagram_username || null,
    instagram_name: connection.instagram_name || null,
    profile_picture_url: connection.profile_picture_url || null,
    granted_scopes: connection.granted_scopes || [],
    token_expires_at: connection.token_expires_at || null,
    last_connected_at: connection.last_connected_at || null,
    last_refreshed_at: connection.last_refreshed_at || null,
    last_publish_at: connection.last_publish_at || null,
    last_error: connection.last_error || null,
    token_storage_mode: connection.token_storage_mode || null,
    token_encryption_status: connection.token_storage_mode === "encrypted"
      ? "encrypted"
      : (process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY ? "will_encrypt_on_next_use" : "requires_reconnect_or_key"),
  };
}

async function getInstagramConnectionSummary() {
  const connection = await getConnectionRecord();
  if (!connection) return serialiseConnection(connection);
  const safeConnection = await ensureConnectionTokenEncryption(connection);
  return serialiseConnection(safeConnection);
}

async function createInstagramConnectStart() {
  const state = buildOauthState();
  return {
    auth_url: buildAuthUrl(state),
    state,
  };
}

async function connectInstagramFromCode({ code, state }) {
  assertInstagramEnv();
  assertTokenEncryptionConfigured();
  verifyOauthState(state);

  const shortLived = await exchangeCodeForUserToken(code);
  const longLived = await exchangeForLongLivedUserToken(shortLived.access_token).catch(() => null);
  const activeToken = trimValue(longLived?.access_token || shortLived?.access_token);

  if (!activeToken) {
    throw new Error("Instagram did not return a usable access token");
  }

  const profile = await getInstagramProfile(activeToken);
  const encryptedToken = encryptToken(activeToken);
  const expiresInSeconds = Number(
    longLived?.expires_in
    || shortLived?.expires_in
    || (!longLived ? DEFAULT_SHORT_TOKEN_TTL_SECONDS : 0)
  );
  const tokenExpiry = parseExpiry(expiresInSeconds);
  const existing = await getConnectionRecord();

  const connection = await saveConnection(existing, {
    provider: "instagram_login",
    login_type: "instagram_business_login",
    status: "connected",
    account_type: profile.account_type || null,
    facebook_user_id: null,
    facebook_page_id: null,
    facebook_page_name: null,
    instagram_user_id: profile.instagram_user_id || null,
    instagram_username: profile.username || null,
    instagram_name: profile.name || null,
    profile_picture_url: profile.profile_picture_url || null,
    user_access_token_encrypted: encryptedToken.value,
    page_access_token_encrypted: null,
    token_storage_mode: encryptedToken.mode,
    granted_scopes: getScopes(),
    token_expires_at: tokenExpiry,
    last_connected_at: new Date(),
    last_refreshed_at: new Date(),
    last_error: null,
    metadata_json: {
      login_type: "instagram_business_login",
      oauth_response: {
        token_source: longLived ? "long_lived" : "short_lived",
        expires_in: expiresInSeconds || null,
      },
      profile: {
        app_scoped_id: profile.app_scoped_id || null,
        instagram_user_id: profile.instagram_user_id || null,
        account_type: profile.account_type || null,
        followers_count: profile.followers_count,
        follows_count: profile.follows_count,
        media_count: profile.media_count,
      },
    },
  });

  return serialiseConnection(connection);
}

async function disconnectInstagramConnection() {
  const existing = await getConnectionRecord();
  if (!existing) return serialiseConnection(null);

  const connection = await saveConnection(existing, {
    provider: "instagram_login",
    login_type: "instagram_business_login",
    status: "disconnected",
    user_access_token_encrypted: null,
    page_access_token_encrypted: null,
    token_expires_at: null,
    last_error: null,
  });

  return serialiseConnection(connection);
}

async function maybeRefreshConnectionToken(connection) {
  if (!connection) throw new Error("Instagram account is not connected");

  const encryptionSafeConnection = await ensureConnectionTokenEncryption(connection);
  const userAccessToken = decryptToken(encryptionSafeConnection.user_access_token_encrypted, encryptionSafeConnection.token_storage_mode);
  if (!userAccessToken) throw new Error("Instagram access token is missing. Reconnect the account.");

  const expiresAt = encryptionSafeConnection.token_expires_at ? new Date(encryptionSafeConnection.token_expires_at) : null;
  const shouldAttemptRefresh = expiresAt && (expiresAt.getTime() - Date.now() <= REFRESH_WINDOW_MS);

  if (!shouldAttemptRefresh) {
    return {
      connection: encryptionSafeConnection,
      user_access_token: userAccessToken,
    };
  }

  try {
    const refreshed = await refreshLongLivedUserToken(userAccessToken);
    const nextToken = trimValue(refreshed?.access_token || userAccessToken);
    const encryptedToken = encryptToken(nextToken);
    const nextExpiry = parseExpiry(refreshed?.expires_in, 60 * 24 * 60 * 60);
    const profile = await getInstagramProfile(nextToken).catch(() => null);

    const updated = await saveConnection(encryptionSafeConnection, {
      provider: "instagram_login",
      login_type: "instagram_business_login",
      status: "connected",
      account_type: profile?.account_type || encryptionSafeConnection.account_type || null,
      instagram_user_id: profile?.instagram_user_id || encryptionSafeConnection.instagram_user_id || null,
      instagram_username: profile?.username || encryptionSafeConnection.instagram_username || null,
      instagram_name: profile?.name || encryptionSafeConnection.instagram_name || null,
      profile_picture_url: profile?.profile_picture_url || encryptionSafeConnection.profile_picture_url || null,
      user_access_token_encrypted: encryptedToken.value,
      token_storage_mode: encryptedToken.mode,
      token_expires_at: nextExpiry || encryptionSafeConnection.token_expires_at,
      last_refreshed_at: new Date(),
      last_error: null,
      metadata_json: {
        ...(encryptionSafeConnection.metadata_json || {}),
        login_type: "instagram_business_login",
        oauth_response: {
          ...(encryptionSafeConnection.metadata_json?.oauth_response || {}),
          token_source: "long_lived",
          expires_in: Number(refreshed?.expires_in || 0) || null,
        },
        profile: {
          ...(encryptionSafeConnection.metadata_json?.profile || {}),
          ...(profile ? {
            app_scoped_id: profile.app_scoped_id || encryptionSafeConnection.metadata_json?.profile?.app_scoped_id || null,
            instagram_user_id: profile.instagram_user_id || encryptionSafeConnection.instagram_user_id || null,
            account_type: profile.account_type || encryptionSafeConnection.account_type || null,
            followers_count: profile.followers_count,
            follows_count: profile.follows_count,
            media_count: profile.media_count,
          } : {}),
        },
      },
    });

    return {
      connection: updated,
      user_access_token: nextToken,
    };
  } catch (error) {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new Error("Instagram access token expired. Reconnect the account.");
    }

    return {
      connection: encryptionSafeConnection,
      user_access_token: userAccessToken,
      refresh_error: error instanceof Error ? error.message : "Instagram token refresh failed",
    };
  }
}

async function getActiveInstagramConnection({ withTokens = false, refreshIfNeeded = false } = {}) {
  const connection = await getConnectionRecord();
  if (!connection || connection.status !== "connected") {
    throw new Error("Instagram account is not connected");
  }

  let activeConnection = connection;
  let userAccessToken = null;

  if (withTokens || refreshIfNeeded) {
    const refreshed = refreshIfNeeded
      ? await maybeRefreshConnectionToken(connection)
      : {
        connection: await ensureConnectionTokenEncryption(connection),
        user_access_token: null,
      };

    activeConnection = refreshed.connection;
    userAccessToken = refreshed.user_access_token
      || decryptToken(activeConnection.user_access_token_encrypted, activeConnection.token_storage_mode);
  }

  const summary = serialiseConnection(activeConnection);
  if (!withTokens) return { ...summary, raw: activeConnection };

  return {
    ...summary,
    raw: activeConnection,
    user_access_token: userAccessToken,
    page_access_token: null,
  };
}

async function markInstagramPublishSuccess() {
  const existing = await getConnectionRecord();
  if (!existing) return;
  await saveConnection(existing, { last_publish_at: new Date(), last_error: null });
}

async function markInstagramConnectionError(message) {
  const existing = await getConnectionRecord();
  if (!existing) return;
  await saveConnection(existing, {
    provider: "instagram_login",
    login_type: "instagram_business_login",
    last_error: String(message || "Instagram connection error"),
  });
}

module.exports = {
  buildAuthUrl,
  createInstagramConnectStart,
  connectInstagramFromCode,
  disconnectInstagramConnection,
  getActiveInstagramConnection,
  getGraphVersion,
  getInstagramConnectionSummary,
  markInstagramConnectionError,
  markInstagramPublishSuccess,
  serialiseConnection,
};
