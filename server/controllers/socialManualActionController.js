const {
  getManualAction,
  listManualActions,
  updateManualAction,
} = require("../services/social/socialManualActionService");

function options(req) {
  return {
    actor: req.user,
    requestId: req.id || null,
  };
}

function sendError(res, error, fallbackStatus = 500) {
  return res.status(error.statusCode || error.status || fallbackStatus).json({
    message: error.message || "Manual-action request failed",
    ...(error.code ? { code: error.code } : {}),
  });
}

async function list(req, res) {
  try {
    res.json(await listManualActions(req.query || {}));
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function get(req, res) {
  try {
    res.json({ action: await getManualAction(req.params.id) });
  } catch (error) {
    sendError(res, error, 404);
  }
}

async function update(req, res) {
  try {
    const action = await updateManualAction(req.params.id, req.body || {}, options(req));
    res.json({ message: `Manual action marked ${String(action.status).toLowerCase().replace(/_/g, " ")}`, action });
  } catch (error) {
    sendError(res, error, 400);
  }
}

module.exports = { get, list, update };
