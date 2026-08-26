# Fully AI Social Manager correction plan

## Objective

Pink Paisa's Social Media Manager must answer what to publish today, why today, which format to use, what exact copy to use, what original visual to create, and where to send the audience. OpenAI makes the strategic and creative decisions, application code validates and operates the workflow, and a human administrator approves the final revision before publication.

## Existing behavior and root cause

The original foundation treated external AI as optional. Provider or compliance failure could be converted into deterministic evergreen copy, and the creative renderer could create the complete background from a branded Sharp/SVG template. The canonical package used one generic structure containing slide, story, and reel arrays regardless of the selected format. Image-provider settings existed, but the daily workflow did not require an actual image API result.

The root causes are:

- deterministic evergreen candidates and copy were embedded in application code;
- `generation.fallback_mode` defaulted to `EVERGREEN`;
- the renderer accepted a missing AI base image and silently produced a template-only asset;
- generation could be marked successful after creative failure;
- text stages lacked a compliance-directed revision loop;
- the data model did not retain separate original-AI and final-composed visual provenance;
- format-specific schemas and explicit AI/image failure outcomes were absent.

## Files and components to modify

### Server workflow

- `server/services/social/socialSchemas.js`: separate daily analysis, candidate, strategy, single-image, carousel, reel, story, product, compliance, revision, visual-brief, and final-package schemas.
- `server/services/social/openAiSocialProvider.js`: current OpenAI SDK integration, corrected structured-output retries, compliance revision, format rewrite, and prompt version 2 definitions.
- `server/services/social/socialDecisionEngine.js`: remove deterministic authored content and preserve the AI strategist's selection unless a hard restriction fails it.
- `server/services/social/socialManagerService.js`: run the revision and image loops, persist every attempt, fail transparently, and save only a completed package as `NEEDS_REVIEW`.
- `server/services/socialCreativeService.js`: require an original AI visual in production mode, preserve it, then overlay exact copy/logo/disclosures.
- Social Manager controller/routes: independent strategy, copy, format, compliance, and image regeneration actions.

### Data and configuration

- `server/models/SocialGenerationRun.js`: explicit compliance/image outcomes, content/image stages, request metadata, market analysis, revision attempts, image attempts, provider response metadata, failed-partial-draft reference, and usage/cost.
- `server/models/SocialPostDraft.js`: all supported formats, generation/visual mode, full-AI readiness, and separate original/final asset references.
- `server/models/SocialAsset.js`: original-AI versus final-composed roles, visual mode, prompt/model/response identifiers, original visual metadata, reference assets, validation, and cost.
- `server/models/SocialPromptVersion.js`: separate external-research and daily-analysis provenance plus versioned revision, format rewrite, visual brief, image prompt revision, and image generation stages.
- `server/utils/socialManagerSettings.js`: settings version 2, mandatory full-AI and human-approval invariants, separate revision/image retry limits, and OpenAI image configuration.
- `server/scripts/migrate/social-media-manager-foundation.js`: idempotent version 2 settings, prompt activation, legacy labeling, and asset-index migration.

### Admin interface

- Add Auto Choose and supported format overrides.
- Display market/internal signals, format reason, candidates, exact format-specific copy, compliance/revision attempts, model/prompt provenance, original AI visual, final composed asset, costs, and transparent failures.
- Add independent strategy, copy, format, compliance, and image regeneration controls.

## Data-model and API contract changes

- New production rows use `generation_mode=FULL_AI` and `visual_mode=AI_VISUAL_WITH_EXACT_OVERLAY` unless an administrator explicitly selects `FULL_AI_GRAPHIC`.
- `FAILED_COMPLIANCE` and `FAILED_IMAGE_GENERATION` are terminal generation outcomes after bounded retries.
- A failed run must not have a successful/completed draft. A partial draft retained for recovery must have status `FAILED` and visible error details.
- Successful generation requires validated original AI visual metadata and final composed assets before the draft becomes `NEEDS_REVIEW`.
- Legacy deterministic/template rows remain immutable history and are labeled `LEGACY_FALLBACK` or `LEGACY_PARTIAL_AI`; they are not presented as fully AI-generated.
- Exact product facts and authentic product-image references come only from verified active database records.

## Migration requirements

1. Back up MongoDB and `server/uploads` and stop the API/worker generation loop.
2. Deploy the API, worker, frontend, package lock, environment examples, and migration together.
3. Run `npm run migrate:social-manager` from `server`.
4. The migration upgrades persisted settings to version 2 while preserving known brand, campaign, research, schedule, notification, and publishing choices.
5. It forces OpenAI text/image providers, the configured social image model, three-attempt limits, deterministic/template fallback off, and mandatory approval.
6. It creates and activates immutable version 2 prompt rows, deactivating prior active rows without deleting history.
7. It labels existing runs/drafts/assets as legacy and replaces the old asset-group/slide unique index with an asset-role-aware index.
8. Rerun the migration to prove idempotency before restarting the API and worker.

## Environment requirements

The production examples define:

- `OPENAI_SOCIAL_TEXT_MODEL`
- `OPENAI_SOCIAL_RESEARCH_MODEL`
- `OPENAI_SOCIAL_COMPLIANCE_MODEL`
- `OPENAI_SOCIAL_IMAGE_MODEL`
- `OPENAI_SOCIAL_IMAGE_SIZE`
- `OPENAI_SOCIAL_IMAGE_QUALITY`
- `OPENAI_SOCIAL_IMAGE_OUTPUT_FORMAT`
- `SOCIAL_AI_FULL_GENERATION=true`
- `SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK=false`
- `SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK=false`
- `SOCIAL_MAX_CONTENT_REVISIONS=3`
- `SOCIAL_MAX_IMAGE_RETRIES=3`
- `SOCIAL_REQUIRE_HUMAN_APPROVAL=true`
- `SOCIAL_DEFAULT_VISUAL_MODE=AI_VISUAL_WITH_EXACT_OVERLAY`

No credential belongs in source control or the deployment archive.

## Test changes

Automated tests must inject fake OpenAI clients and local base64 image fixtures. CI must never use a real API key or make a paid request. Tests must cover AI format choice, complete single-image and carousel packages, actual image-provider invocation, non-template final artwork, corrected structured-output retries, compliance revision and exhaustion, image retry and exhaustion, visible failed states, independent regeneration, product authenticity, duplicate prevention, and mandatory current-revision approval.

The release gate remains the complete backend test suite, frontend lint/type checking, and production build. A separately authorized deployment smoke test may use one paid image request; it is never part of CI.

## Deployment and rollback

- Deploy and migrate with direct Instagram publishing disabled.
- Generate one controlled single-image post and one format-appropriate carousel; confirm original and final assets are different stored files with complete provenance.
- Confirm an invalid compliance fixture ends as `FAILED_COMPLIANCE` and an image failure never creates a template-only success.
- Enable publishing only after the existing Instagram, HTTPS media, approval, and durable-publication gates pass.
- Rollback disables generation and publishing but preserves version 2 settings, prompts, attempts, assets, drafts, audits, and publication checkpoints for investigation.

## Completion criteria

The correction is complete only when OpenAI selects the strategy and format, generates all copy, creates the actual original visual through the configured image API, compliance revisions remain AI-authored, failures remain explicit, successful packages enter human review, and no standard daily path can silently create deterministic content or template-only artwork.
