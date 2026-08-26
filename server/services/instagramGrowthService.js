const core = require("./social/instagramGrowthService");
const { getActiveInstagramConnection } = require("./instagramConnectionService");

function suppliedCredentialSettings(settings = {}) {
  const source = settings.instagram || settings;
  return Boolean(source?.accessToken && (source?.accountId || source?.instagramUserId));
}

async function resolveOperationSettings(options = {}, { tokenPreference = "page" } = {}) {
  if (suppliedCredentialSettings(options.settings || {})) return options.settings;
  if (typeof options.dependencies?.getInstagramGrowthSettings === "function") {
    return options.dependencies.getInstagramGrowthSettings();
  }
  const environment = options.dependencies?.env || process.env;
  if (environment.INSTAGRAM_ACCESS_TOKEN && environment.INSTAGRAM_USER_ID) {
    return options.settings || {};
  }
  const connection = await getActiveInstagramConnection({ withTokens: true, refreshIfNeeded: true });
  let accessToken = connection.user_access_token;
  if (connection.provider === "facebook_login") {
    accessToken = tokenPreference === "user"
      ? connection.user_access_token
      : (connection.page_access_token || connection.user_access_token);
    if (tokenPreference === "user" && !accessToken) {
      const error = new Error("Official Meta research requires the connected Facebook User access token; reconnect through the reviewed Facebook Login and Page-selection flow.");
      error.code = "FACEBOOK_USER_TOKEN_REQUIRED";
      throw error;
    }
  }
  return {
    ...(options.settings || {}),
    instagram: {
      ...((options.settings || {}).instagram || {}),
      provider: connection.provider || "instagram_login",
      accountId: connection.instagram_user_id,
      accountType: connection.account_type,
      pageId: connection.facebook_page_id,
      accessToken,
      scopes: connection.granted_scopes || [],
    },
  };
}

function connectedOperation(method, settings = {}) {
  return async (options = {}) => core[method]({
    ...options,
    settings: await resolveOperationSettings(options, settings),
  });
}

const connectedResearchOperation = (method) => connectedOperation(method, { tokenPreference: "user" });

module.exports = {
  ...core,
  deleteComment: connectedOperation("deleteComment"),
  deleteInstagramComment: connectedOperation("deleteInstagramComment"),
  getComments: connectedOperation("getComments"),
  getBusinessDiscovery: connectedResearchOperation("getBusinessDiscovery"),
  getHashtag: connectedResearchOperation("getHashtag"),
  getHashtagMedia: connectedResearchOperation("getHashtagMedia"),
  getInsights: connectedOperation("getInsights"),
  getInstagramBusinessDiscovery: connectedResearchOperation("getInstagramBusinessDiscovery"),
  getInstagramComments: connectedOperation("getInstagramComments"),
  getInstagramHashtag: connectedResearchOperation("getInstagramHashtag"),
  getInstagramHashtagMedia: connectedResearchOperation("getInstagramHashtagMedia"),
  getInstagramInsights: connectedOperation("getInstagramInsights"),
  getMediaInsights: connectedOperation("getMediaInsights"),
  getMentions: connectedOperation("getMentions"),
  getRecentlySearchedHashtags: connectedResearchOperation("getRecentlySearchedHashtags"),
  getInstagramRecentlySearchedHashtags: connectedResearchOperation("getInstagramRecentlySearchedHashtags"),
  getTaggedMedia: connectedOperation("getTaggedMedia"),
  hideComment: connectedOperation("hideComment"),
  hideInstagramComment: connectedOperation("hideInstagramComment"),
  listComments: connectedOperation("listComments"),
  replyToComment: connectedOperation("replyToComment"),
  replyToInstagramComment: connectedOperation("replyToInstagramComment"),
  sendInstagramPrivateReply: connectedOperation("sendInstagramPrivateReply"),
  sendMessage: connectedOperation("sendMessage"),
  sendPermittedInstagramMessage: connectedOperation("sendPermittedInstagramMessage"),
  sendPermittedMessage: connectedOperation("sendPermittedMessage"),
  sendPrivateReply: connectedOperation("sendPrivateReply"),
  searchHashtag: connectedResearchOperation("searchHashtag"),
  searchInstagramHashtag: connectedResearchOperation("searchInstagramHashtag"),
  setCommentHidden: connectedOperation("setCommentHidden"),
  setInstagramCommentHidden: connectedOperation("setInstagramCommentHidden"),
  unhideComment: connectedOperation("unhideComment"),
  unhideInstagramComment: connectedOperation("unhideInstagramComment"),
  _private: {
    ...core._private,
    resolveOperationSettings,
    suppliedCredentialSettings,
  },
};
