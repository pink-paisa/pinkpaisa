const {
  addMetricSnapshot,
  approveAndScheduleDraft,
  approveDraft,
  duplicateDraft,
  factCheckDraft,
  getDraftDetail,
  getGenerationRun,
  getPerformanceSummary,
  getPublishingReadiness,
  getTodayRecommendation,
  listDraftCalendar,
  processPendingSocialGenerationRuns,
  publicDraft,
  publicRun,
  publishDraftNow,
  regenerateDraftPart,
  regenerateDraftVisual,
  rejectDraft,
  requestGeneration,
  retryGenerationRun,
  scheduleDraft,
  submitDraftForReview,
  updateDraftPackage,
  updateSocialManagerSettings,
} = require("../services/social/socialManagerService");
const { getSocialManagerSettings } = require("../utils/socialManagerSettings");
const { reconcileUncertainPublication } = require("../services/social/socialPublishingService");
const {
  deleteGeneratedContent,
  previewGeneratedContentCleanup,
} = require("../services/social/socialGeneratedContentCleanupService");
const { archiveGenerationFailure } = require("../services/social/socialFailureRecoveryService");

function context(req) {
  return {
    actor: req.user,
    requestId: req.id || null,
    ip: req.ip || req.socket?.remoteAddress || null,
  };
}

function errorResponse(error) {
  return {
    message: error.message || "Social Media Manager request failed",
    ...(error.code ? { code: error.code } : {}),
    ...(error.issues ? { issues: error.issues } : {}),
    ...(error.validation_errors ? { validation_errors: error.validation_errors } : {}),
    ...(error.compliance ? { compliance: error.compliance } : {}),
    ...(error.readiness ? { readiness: error.readiness } : {}),
    ...(error.visual_mode_resolution ? { visual_mode_resolution: error.visual_mode_resolution } : {}),
  };
}

function sendError(res, error, fallbackStatus = 500) {
  return res.status(error.statusCode || error.status || fallbackStatus).json(errorResponse(error));
}

function requiredPaidRequestKey(req) {
  const value = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  const key = String(Array.isArray(value) ? value[0] || "" : value || "").trim();
  if (!key) {
    const error = new Error("Idempotency-Key is required for paid Social Manager operations");
    error.code = "social_paid_operation_idempotency_key_required";
    error.statusCode = 400;
    throw error;
  }
  if (key.length > 300 || !/^[\x21-\x7E]+$/.test(key)) {
    const error = new Error("Idempotency-Key must contain 1 to 300 visible ASCII characters without spaces");
    error.code = "social_paid_operation_idempotency_key_invalid";
    error.statusCode = 400;
    throw error;
  }
  return key;
}

async function getToday(req, res) {
  try {
    res.json(await getTodayRecommendation());
  } catch (error) {
    sendError(res, error);
  }
}

async function generate(req, res) {
  try {
    const result = await requestGeneration({
      triggerType: "MANUAL",
      actor: req.user,
      force: Boolean(req.body?.force),
      requestKey: req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null,
      generationRequest: req.body || {},
    });
    if (!result.draft && ["PENDING", "RUNNING"].includes(result.run?.status)) {
      setImmediate(() => {
        void processPendingSocialGenerationRuns({ limit: 1 }).catch((error) => {
          (req.log || console).error({ err: error }, "manual social generation worker failed");
        });
      });
    }
    res.status(result.draft ? 200 : 202).json({
      message: result.draft ? "Today’s recommendation is ready" : result.reused ? "Today’s recommendation is already being generated" : "Today’s recommendation was queued",
      queued: !result.draft,
      reused: result.reused,
      generation_run: publicRun(result.run),
      draft: result.draft ? publicDraft(result.draft) : null,
    });
  } catch (error) {
    sendError(res, error);
  }
}

async function getRun(req, res) {
  try {
    res.json(await getGenerationRun(req.params.id));
  } catch (error) {
    sendError(res, error, 404);
  }
}

async function retryRun(req, res) {
  try {
    const result = await retryGenerationRun(req.params.id, {
      ...context(req),
      additionalInstructions: req.body?.instructions || req.body?.admin_instructions || null,
      requestKey: req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null,
    });
    setImmediate(() => {
      void processPendingSocialGenerationRuns({ limit: 1 }).catch((error) => {
        (req.log || console).error({ err: error }, "retried social generation worker failed");
      });
    });
    res.status(202).json({
      message: "Social generation retry was queued",
      queued: true,
      generation_run: publicRun(result.run),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function archiveRunFailure(req, res) {
  try {
    const result = await archiveGenerationFailure(req.params.id, {
      ...context(req),
      reason: req.body?.reason || req.body?.notes || null,
    });
    res.json({
      message: result.reused
        ? "This generation failure was already dismissed"
        : "The generation failure was dismissed from actionable recovery; its audit history remains available",
      reused: result.reused,
      generation_run: publicRun(result.run),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function listDrafts(req, res) {
  try {
    res.json(await listDraftCalendar({
      status: req.query.status || null,
      dateFrom: req.query.from || req.query.date_from || null,
      dateTo: req.query.to || req.query.date_to || null,
      page: req.query.page || 1,
      limit: req.query.limit || 50,
    }));
  } catch (error) {
    sendError(res, error);
  }
}

async function generatedContentCleanupPreview(_req, res) {
  try {
    res.json(await previewGeneratedContentCleanup());
  } catch (error) {
    sendError(res, error, 503);
  }
}

async function cleanupGeneratedContent(req, res) {
  try {
    const result = await deleteGeneratedContent({
      confirmation: req.body?.confirmation,
      purgeToken: req.body?.purge_token,
      actor: req.user,
      requestId: req.id || null,
      requestKey: req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null,
    });
    res.json({
      message: result.file_cleanup?.failed
        ? "Generated Social Manager records were deleted, but some local media files need attention"
        : "Generated Social Manager content was deleted",
      ...result,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function getDraft(req, res) {
  try {
    res.json({ draft: await getDraftDetail(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
}

async function updateDraft(req, res) {
  try {
    res.json({ message: "Draft saved and revalidated", draft: await updateDraftPackage(req.params.id, req.body || {}, context(req)) });
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function submitReview(req, res) {
  try {
    res.json({ message: "Draft submitted for review", draft: await submitDraftForReview(req.params.id, context(req)) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function approve(req, res) {
  try {
    res.json({ message: "Draft and creative approved", draft: await approveDraft(req.params.id, context(req)) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function approveAndSchedule(req, res) {
  try {
    const result = await approveAndScheduleDraft(req.params.id, req.body?.scheduled_for, {
      ...context(req),
      requestKey: req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null,
      scheduleOverrideReason: req.body?.schedule_override_reason || null,
      includeCompanionStory: req.body?.include_companion_story === true,
    });
    res.json({
      message: result.reused ? "This draft was already approved and scheduled" : "Draft approved and scheduled",
      reused: result.reused,
      draft: result.draft,
      companion_story: result.companion_story,
      queue_navigation: result.queue_navigation,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function reject(req, res) {
  try {
    res.json({ message: "Draft rejected", draft: await rejectDraft(req.params.id, req.body?.reason || req.body?.notes, context(req)) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function schedule(req, res) {
  try {
    res.json({
      message: "Draft scheduled",
      draft: await scheduleDraft(req.params.id, req.body?.scheduled_for, {
        ...context(req),
        scheduleOverrideReason: req.body?.schedule_override_reason || null,
      }),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function publish(req, res) {
  try {
    res.status(202).json({ message: "Instagram publication queued; the durable worker will report the final outcome", ...(await publishDraftNow(req.params.id, context(req))) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function duplicate(req, res) {
  try {
    const requestKey = requiredPaidRequestKey(req);
    res.status(201).json({
      message: "Draft duplicated as a new unapproved package",
      draft: await duplicateDraft(req.params.id, {
        ...context(req),
        requestKey,
      }),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function regenerate(req, res) {
  try {
    const requestKey = requiredPaidRequestKey(req);
    const scope = req.body?.scope || "alternatives";
    const options = {
      ...context(req),
      requestKey,
      instructions: req.body?.instructions || req.body?.admin_instructions || null,
      targetFormat: req.body?.target_format || req.body?.format || null,
    };
    const draft = ["image", "visual_asset"].includes(String(scope).toLowerCase())
      ? await regenerateDraftVisual(req.params.id, {
        ...options,
        visualMode: req.body?.visual_mode || null,
        assetSequence: req.body?.asset_sequence ?? null,
      })
      : await regenerateDraftPart(req.params.id, scope, options);
    res.json({ message: `${String(scope).replace(/_/g, " ")} regenerated`, draft });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function renderAssets(req, res) {
  try {
    const requestKey = requiredPaidRequestKey(req);
    const templateMode = req.body?.template_mode === true;
    res.json({
      message: "OpenAI visual generated and the final creative was validated",
      draft: await regenerateDraftVisual(req.params.id, {
        ...context(req),
        requestKey,
        templateMode,
        visualMode: req.body?.visual_mode || null,
        assetSequence: req.body?.asset_sequence ?? null,
      }),
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function factCheck(req, res) {
  try {
    res.json({ message: "Fact check completed", draft: await factCheckDraft(req.params.id, context(req)) });
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function addMetrics(req, res) {
  try {
    const snapshot = await addMetricSnapshot(req.params.id, {
      ...req.body,
      source: String(req.body?.source || "MANUAL").toUpperCase(),
      provenance_note: req.body?.provenance_note || req.body?.notes,
    }, {
      ...context(req),
      requestKey: req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null,
    });
    res.status(201).json({ message: "Performance snapshot saved", snapshot, draft: await getDraftDetail(req.params.id) });
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function getSettings(_req, res) {
  try {
    const [settings, today] = await Promise.all([getSocialManagerSettings(), getTodayRecommendation()]);
    res.json({ settings, readiness: today.readiness });
  } catch (error) {
    sendError(res, error);
  }
}

async function updateSettings(req, res) {
  try {
    const settings = await updateSocialManagerSettings(req.body?.settings || req.body || {}, context(req));
    const today = await getTodayRecommendation();
    res.json({ message: "Social Media Manager settings saved", settings, readiness: today.readiness });
  } catch (error) {
    sendError(res, error, 400);
  }
}

async function performance(req, res) {
  try {
    res.json(await getPerformanceSummary({ days: req.query.days || 90 }));
  } catch (error) {
    sendError(res, error);
  }
}

async function publishingReadiness(req, res) {
  try {
    res.json(await getPublishingReadiness(req.params.id));
  } catch (error) {
    sendError(res, error, 409);
  }
}

async function reconcilePublication(req, res) {
  try {
    const result = await reconcileUncertainPublication(req.params.id, {
      actor: req.user,
      externalPublicationId: req.body?.external_publication_id,
      externalPermalink: req.body?.external_permalink ?? null,
      notes: req.body?.notes,
    });
    res.json({
      message: result.reused
        ? "This publication was already reconciled with the same Meta media identifier"
        : "The uncertain publication was reconciled without another Meta publish call",
      ...result,
    });
  } catch (error) {
    sendError(res, error, 409);
  }
}

module.exports = {
  addMetrics,
  archiveRunFailure,
  approve,
  approveAndSchedule,
  cleanupGeneratedContent,
  duplicate,
  factCheck,
  generate,
  generatedContentCleanupPreview,
  getDraft,
  getRun,
  getSettings,
  getToday,
  listDrafts,
  performance,
  publish,
  publishingReadiness,
  reconcilePublication,
  regenerate,
  reject,
  renderAssets,
  retryRun,
  schedule,
  submitReview,
  updateDraft,
  updateSettings,
  _private: { requiredPaidRequestKey },
};
