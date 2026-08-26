const crypto = require("crypto");
const { getJwtSecret } = require("./authConfig");

const TOKEN_VERSION = 2;
const SUPPORTED_TOKEN_VERSIONS = new Set([1, TOKEN_VERSION]);

function sign(payload) {
  return crypto.createHmac("sha256", getJwtSecret()).update(payload).digest("base64url");
}

function createMarketingUnsubscribeToken(lead) {
  const body = Buffer.from(JSON.stringify({
    v: TOKEN_VERSION,
    lead_id: String(lead?._id || lead?.id || ""),
  })).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyMarketingUnsubscribeToken(token) {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) return null;
  const expected = sign(body);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!SUPPORTED_TOKEN_VERSIONS.has(parsed.v) || !/^[0-9a-f]{24}$/i.test(String(parsed.lead_id || ""))) return null;
    return {
      lead_id: String(parsed.lead_id),
    };
  } catch {
    return null;
  }
}

module.exports = {
  createMarketingUnsubscribeToken,
  verifyMarketingUnsubscribeToken,
};
