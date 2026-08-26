const {
  deactivateAudioTrack,
  getAudioTrackFile,
  listAudioTracks,
  selectDraftAudioTrack,
  updateAudioTrack,
  uploadAudioTrack,
} = require("../services/social/socialAudioLibraryService");
const {
  getDraftDetail,
} = require("../services/social/socialManagerService");

function options(req) {
  return {
    actor: req.user,
    requestId: req.id || null,
    ip: req.ip || req.socket?.remoteAddress || null,
  };
}

function sendError(res, error, fallbackStatus = 500) {
  return res.status(error.statusCode || error.status || fallbackStatus).json({
    message: error.message || "Audio-library request failed",
    ...(error.code ? { code: error.code } : {}),
  });
}

async function list(req, res) {
  try {
    res.json(await listAudioTracks({ includeInactive: ["true", "1"].includes(String(req.query.include_inactive || "").toLowerCase()) }));
  } catch (error) {
    sendError(res, error);
  }
}

async function upload(req, res) {
  try {
    const track = await uploadAudioTrack({ file: req.file, input: req.body || {}, ...options(req) });
    res.status(201).json({ message: "Licensed audio uploaded and rights confirmation recorded", track });
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function stream(req, res) {
  try {
    const { track, filePath } = await getAudioTrackFile(req.params.id);
    res.type(track.mime_type);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Disposition", `inline; filename="${String(track.original_filename || "audio").replace(/[\r\n\"]/g, "_")}"`);
    return res.sendFile(filePath, { acceptRanges: true, cacheControl: false });
  } catch (error) {
    return sendError(res, error, 404);
  }
}

async function update(req, res) {
  try {
    const track = await updateAudioTrack(req.params.id, req.body || {}, options(req));
    res.json({ message: "Audio-library metadata updated", track });
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function deactivate(req, res) {
  try {
    const track = await deactivateAudioTrack(req.params.id, req.body?.reason, options(req));
    res.json({ message: "Audio track revoked and affected Reels and Video Feeds blocked for review", track });
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function selectForDraftWithServices(req, res, {
  selectDraftAudioTrackImpl = selectDraftAudioTrack,
  getDraftDetailImpl = getDraftDetail,
} = {}) {
  try {
    const selection = await selectDraftAudioTrackImpl(req.params.id, req.body?.audio_track_id || null, options(req));
    const draft = await getDraftDetailImpl(req.params.id);
    res.json({
      message: selection.reused
        ? "The selected audio was already applied to this video"
        : "Licensed audio selected, video rebuilt from retained frames, and human approval reset",
      selected_track: selection.selected_track,
      draft,
    });
  } catch (error) {
    sendError(res, error, 422);
  }
}

async function selectForDraft(req, res) {
  return selectForDraftWithServices(req, res);
}

module.exports = {
  deactivate,
  list,
  selectForDraft,
  stream,
  update,
  upload,
  _private: { selectForDraftWithServices },
};
