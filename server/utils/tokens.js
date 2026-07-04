const crypto = require("crypto");

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createSecureToken(byteLength = 32) {
  const raw = crypto.randomBytes(byteLength).toString("hex");
  return {
    raw,
    hash: hashToken(raw),
  };
}

module.exports = {
  createSecureToken,
  hashToken,
};
