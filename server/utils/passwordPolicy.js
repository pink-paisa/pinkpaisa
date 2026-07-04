const COMMON_PASSWORDS = new Set([
  "1234567890",
  "12345678",
  "123456789",
  "qwerty123",
  "password",
  "password1",
  "password123",
  "admin123",
  "welcome123",
  "letmein123",
  "pinkpaisa",
  "pinkpaisa123",
]);

const PASSWORD_POLICY_HINT = "Use at least 10 characters with at least one letter and one number.";

function getPasswordPolicyError(password) {
  const value = String(password || "");
  if (!value) return "Password is required";
  if (value.length < 10) return "Password must be at least 10 characters";
  if (value.length > 128) return "Password must be 128 characters or fewer";
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return "Password must include at least one letter and one number";
  }
  if (COMMON_PASSWORDS.has(value.trim().toLowerCase())) {
    return "Choose a less common password";
  }
  return null;
}

function assertPasswordPolicy(password) {
  const error = getPasswordPolicyError(password);
  if (error) {
    const err = new Error(error);
    err.status = 400;
    throw err;
  }
}

module.exports = {
  PASSWORD_POLICY_HINT,
  assertPasswordPolicy,
  getPasswordPolicyError,
};
