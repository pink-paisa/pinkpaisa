const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function isAccountLocked(record) {
  return Boolean(record?.locked_until && new Date(record.locked_until).getTime() > Date.now());
}

function buildLockedError(message = "Too many failed login attempts. Try again in 15 minutes.") {
  const error = new Error(message);
  error.status = 423;
  return error;
}

async function recordFailedLogin(record) {
  const nextCount = Number(record.failed_login_attempts || 0) + 1;
  record.failed_login_attempts = nextCount;
  if (nextCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
    record.locked_until = new Date(Date.now() + LOGIN_LOCKOUT_MS);
  }
  await record.save();
  return isAccountLocked(record);
}

async function clearLoginFailures(record, ipAddress) {
  record.failed_login_attempts = 0;
  record.locked_until = null;
  record.last_login_at = new Date();
  record.last_login_ip = ipAddress || null;
  await record.save();
}

module.exports = {
  LOGIN_LOCKOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  buildLockedError,
  clearLoginFailures,
  isAccountLocked,
  recordFailedLogin,
};
