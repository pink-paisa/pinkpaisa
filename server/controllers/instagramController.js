const {
  createInstagramConnectStart,
  disconnectInstagramConnection,
  getInstagramConnectionSummary,
} = require("../services/instagramConnectionService");
const { exchangeAuthCodeForToken } = require("../services/instagramPublishService");

function getFrontendAdminUrl(status, message = "") {
  const rawBaseUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "http://localhost:8080").trim();
  const params = new URLSearchParams();
  if (status) params.set("instagram", status);
  if (message) params.set("message", message);

  try {
    const url = new URL(rawBaseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.endsWith("/admin") ? pathname : `${pathname || ""}/admin`;
    url.search = params.toString();
    url.hash = "";
    return url.toString();
  } catch (_error) {
    const fallbackBase = rawBaseUrl.replace(/\/+$/, "");
    const adminBase = fallbackBase.endsWith("/admin") ? fallbackBase : `${fallbackBase}/admin`;
    return `${adminBase}?${params.toString()}`;
  }
}

const getInstagramConnectionController = async (_req, res) => {
  try {
    const connection = await getInstagramConnectionSummary();
    res.json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const startInstagramConnectController = async (_req, res) => {
  try {
    const result = await createInstagramConnectStart();
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const instagramConnectCallbackController = async (req, res) => {
  try {
    if (req.query.error) {
      return res.redirect(getFrontendAdminUrl("error", req.query.error_description || req.query.error));
    }
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code || !state) {
      return res.redirect(getFrontendAdminUrl("error", "Missing Instagram callback code or state"));
    }
    await exchangeAuthCodeForToken({ code, state });
    return res.redirect(getFrontendAdminUrl("connected", "Instagram connected successfully"));
  } catch (error) {
    return res.redirect(getFrontendAdminUrl("error", error.message));
  }
};

const disconnectInstagramController = async (_req, res) => {
  try {
    const connection = await disconnectInstagramConnection();
    res.json({ message: "Instagram connection removed", connection });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  disconnectInstagramController,
  getInstagramConnectionController,
  instagramConnectCallbackController,
  startInstagramConnectController,
};
