function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const error = new Error(`${name} is required`);
    error.status = 500;
    throw error;
  }
  return value;
}

function getJwtSecret() {
  return requireEnv("JWT_SECRET");
}

function getAdminBootstrapEmail() {
  const email = String(process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
  if (email) return email;
  if (process.env.NODE_ENV !== "production") return "pinkpaisawellness2018@gmail.com";
  return requireEnv("ADMIN_BOOTSTRAP_EMAIL").toLowerCase();
}

function getAdminBootstrapPassword() {
  const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "").trim();
  if (password) return password;
  return requireEnv("ADMIN_BOOTSTRAP_PASSWORD");
}

module.exports = {
  getAdminBootstrapEmail,
  getAdminBootstrapPassword,
  getJwtSecret,
  requireEnv,
};
