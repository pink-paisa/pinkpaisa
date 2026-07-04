const CUSTOMER_SESSION_COOKIE = "pinkpaisa_customer_session";
const CUSTOMER_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookieHeader(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getCustomerSessionToken(req) {
  const cookies = parseCookieHeader(req?.headers?.cookie || "");
  if (cookies[CUSTOMER_SESSION_COOKIE]) {
    return cookies[CUSTOMER_SESSION_COOKIE];
  }

  const authHeader = req?.headers?.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  return null;
}

function shouldUseSecureCookies(req) {
  if (process.env.NODE_ENV === "production") return true;
  if (req?.secure) return true;
  return String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase() === "https";
}

function getCustomerSessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" ? true : shouldUseSecureCookies(req),
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE_MS,
  };
}

function setCustomerSessionCookie(res, req, token) {
  res.cookie(CUSTOMER_SESSION_COOKIE, token, getCustomerSessionCookieOptions(req));
}

function clearCustomerSessionCookie(res, req) {
  const options = getCustomerSessionCookieOptions(req);
  res.clearCookie(CUSTOMER_SESSION_COOKIE, {
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
    secure: options.secure,
    path: options.path,
  });
}

module.exports = {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_MAX_AGE_MS,
  parseCookieHeader,
  getCustomerSessionToken,
  getCustomerSessionCookieOptions,
  shouldUseSecureCookies,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
};
