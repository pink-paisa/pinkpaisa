# AI Social Media Manager setup and operations

> Historical version 2 foundation guide. The production Social Growth Team now uses the version 3 weekly operating model; use [the current deployment guide](pink-paisa-social-manager-deployment.md), [architecture](pink-paisa-social-growth-architecture.md), and [administrator guide](pink-paisa-social-manager-admin-guide.md). Legacy daily-generation defaults below are not the current automatic schedule.

This guide covers installation, environment configuration, migration, worker operation, production enablement, recovery, and rollback for Pink Paisa's AI Social Media Manager.

The safe production baseline is deliberately draft-first:

- Daily generation is enabled at 08:00 Asia/Kolkata by default.
- OpenAI web search is disabled by default.
- Instagram publishing is disabled by default at both the server and persisted-settings layers.
- Automatic publishing is disabled by default.
- A human administrator must approve the current draft revision and its active creative assets before any publish attempt.
- The publishing adapter never reports a simulated success.

See [the admin guide](social-media-manager-admin-guide.md) for day-to-day use and [the security guide](social-media-manager-security.md) for the threat model and incident procedure.

## Runtime architecture

| Component | Responsibility |
| --- | --- |
| Next.js admin | `Admin > Growth & Reporting > Social Media Manager`; editing, review, approval, scheduling, export, metrics, settings, and audit views |
| Express API | Admin-only API under `/api/social-media-manager/admin`; strict package and compliance validation |
| MongoDB | Generation runs, drafts, research sources, assets, prompt versions, audit logs, publications, immutable metric snapshots, and persisted settings |
| Marketing worker | Runs the shared scheduler, queues the daily recommendation, claims generation/publication leases, processes retries, and handles both durable Publish-now intents and due scheduled drafts when publishing is enabled |
| OpenAI APIs | Required staged research/analysis, candidate generation, strategy, format-specific copy, compliance/revision, visual brief, final assembly, and original image generation |
| Trusted RSS | Bounded secondary current-research source using configured HTTPS feeds |
| Weak-evidence path | AI may deliberately generate an evergreen opportunity when timely evidence is weak; application code never authors the fallback copy |
| Creative renderer | Sharp/SVG exact-copy overlay on the required original OpenAI visual; template-only output is not a production fallback |
| Instagram adapter | Existing Instagram professional-account connection and resumable Graph API publisher |

## Prerequisites

- Node.js 20 or the version used by the existing Pink Paisa deployment.
- MongoDB reachable through `MONGO_URI`.
- A writable `server/uploads/generated/campaigns` directory. This directory contains both legacy campaign assets and Social Manager creatives.
- A public HTTPS domain for production assets and Instagram publishing.
- At least one Pink Paisa administrator account.
- SMTP credentials in production. The server already requires `EMAIL_PROVIDER=smtp`, `SMTP_USER`, and `SMTP_PASSWORD` at startup.
- A separate PM2 marketing worker in production, unless the API process is intentionally configured to host the scheduler.

OpenAI credentials and access to the configured text and image models are required for generation. The OpenAI project may also require organization verification before GPT Image access is available; verify model access before enabling the daily scheduler. Instagram credentials remain optional until approved-post publication is deliberately enabled.

## Environment configuration

Start from `server/.env.example` locally or `deploy/lightsail/server.env.production.example` in production. Never commit the populated `.env` file.

### Foundation settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | Application database and Social Manager state |
| `JWT_SECRET` | Yes | Admin session validation and CSRF token signing |
| `SERVER_URL` | Yes | Express public URL |
| `PUBLIC_MEDIA_BASE_URL` | Yes for publishing | Prefix used for generated asset URLs; must be public HTTPS for Instagram |
| `PUBLIC_APP_URL` / `FRONTEND_URL` | Yes | First-party landing-page origin and admin links |
| `SMTP_*` and `EMAIL_*` | Production | Required server mail configuration and optional draft-review notifications |
| `SOCIAL_AUDIT_IP_SALT` | Recommended | Salt for one-way source-IP hashes stored in the Social audit log |

Use a unique, high-entropy `SOCIAL_AUDIT_IP_SALT`; do not reuse `JWT_SECRET`. The code has a fallback value, but production should not rely on it.

### Generation and research

| Variable | Default | Behavior |
| --- | --- | --- |
| `SOCIAL_MANAGER_ENABLED` | `true` | Default value for the persisted generation/settings feature flag |
| `SOCIAL_MANAGER_DAILY_GENERATION_ENABLED` | `true` | Default value for whether the scheduler may queue a daily run |
| `SOCIAL_MANAGER_GENERATION_HOUR_IST` | `8` | Scheduled hour in Asia/Kolkata |
| `SOCIAL_MANAGER_GENERATION_MINUTE_IST` | `0` | Scheduled minute in Asia/Kolkata |
| `OPENAI_API_KEY` | Empty | Enables the staged OpenAI decision workflow |
| `SOCIAL_MANAGER_TEXT_PROVIDER` | `openai` | Must remain `openai` for the full-AI workflow |
| `OPENAI_SOCIAL_TEXT_MODEL` | `gpt-5.6-luna` in examples | Base model for strategy, copy, revision, visual brief, and assembly |
| `OPENAI_SOCIAL_RESEARCH_MODEL` | `gpt-5.6-luna` | Daily analysis/research model |
| `OPENAI_SOCIAL_COMPLIANCE_MODEL` | `gpt-5.6-luna` | Independent compliance model |
| `OPENAI_SOCIAL_IMAGE_MODEL` | `gpt-image-2` | Required model for the actual original visual |
| `OPENAI_SOCIAL_IMAGE_SIZE` | `1088x1360` | Requested original-image dimensions; final renderer exports the platform canvas |
| `OPENAI_SOCIAL_IMAGE_QUALITY` | `medium` | OpenAI image quality setting |
| `OPENAI_SOCIAL_IMAGE_OUTPUT_FORMAT` | `png` | Stored original-image format before exact-copy composition |
| `OPENAI_SOCIAL_MODEL` | `gpt-5.6-luna` in examples | Provider fallback when a stage-specific saved model is empty |
| `SOCIAL_MANAGER_STRATEGY_MODEL` | `gpt-5.6-luna` | Default candidate/strategy-stage model |
| `SOCIAL_MANAGER_COPY_MODEL` | `gpt-5.6-luna` | Copy stage model |
| `SOCIAL_MANAGER_COMPLIANCE_MODEL` | `gpt-5.6-luna` | Independent compliance stage model |
| `SOCIAL_MANAGER_WEB_SEARCH_ENABLED` | `false` | Allows `AUTO` research mode to use OpenAI web search |
| `SOCIAL_AI_FULL_GENERATION` | `true` | Requires AI strategy, copy, compliance revision, and original visuals |
| `SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK` | `false` | Must remain false; exhausted text generation becomes a visible failure |
| `SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK` | `false` | Must remain false; exhausted image generation becomes a visible failure |
| `SOCIAL_MAX_CONTENT_REVISIONS` | `3` | Maximum compliance-directed AI revisions |
| `SOCIAL_MAX_IMAGE_RETRIES` | `3` | Maximum image attempts with AI prompt correction |
| `SOCIAL_REQUIRE_HUMAN_APPROVAL` | `true` | Mandatory current-revision approval invariant |
| `SOCIAL_DEFAULT_VISUAL_MODE` | `FULL_AI_GRAPHIC` | Eligible new creatives, including non-product Stories, are complete AI-native graphics; authentic product/affiliate formats resolve to verified exact overlay |
| `SOCIAL_RESEARCH_RSS_FEEDS_JSON` | Empty | Social-specific trusted-feed list; falls back to `PREDICTIONS_RSS_FEEDS_JSON` |
| `SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE` | Required positive value in production (`0.20` conservative example) | Per-paid-image USD estimate used by the monthly budget ledger. Production generation fails closed when this is absent, zero, or invalid. Review it whenever the image model, size, quality, or provider pricing changes. |
| `SOCIAL_GENERATED_ORPHAN_MIN_AGE_MS` | `3600000` | Minimum age before the maintenance worker may remove a generated local file that has no asset, run, paid-call, publication, or marketing reference. Values below five minutes are clamped. |
| `SOCIAL_GENERATED_ORPHAN_SWEEP_INTERVAL_MS` | `3600000` | Interval for the single-lease maintenance sweep that reconciles crash-orphaned generated files. Values below fifteen minutes are clamped. |
| `SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION` | `0` | USD input-token rate used for the server-side OpenAI cost estimate |
| `SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION` | `0` | USD output-token rate used for the server-side OpenAI cost estimate |
| `SOCIAL_MANAGER_INR_PER_USD` | `90` | Converts recorded USD model usage for the monthly INR budget threshold |

The configured research feed value must be a JSON array of feed objects. The existing production example provides authoritative RBI, PIB, and SEBI feeds in `PREDICTIONS_RSS_FEEDS_JSON`. A social-specific list can use the same structure:

```env
SOCIAL_RESEARCH_RSS_FEEDS_JSON=[{"name":"RBI Press Releases","url":"https://rbi.org.in/pressreleases_rss.xml","category":"finance","primary_source":true}]
```

Keep the JSON on one line in `.env`. Every feed must use HTTPS. Redirects are allowed only between hosts already present in the configured feed list.

Most generation, research, model, schedule, and notification environment variables feed the default settings builder. The migration merges the environment-aware version 2 baseline with persisted business settings while forcing the OpenAI providers, configured social image model, three-attempt limits, mandatory approval, and both no-fallback gates. Other persisted settings take precedence afterward and can be changed through the Settings tab or authenticated settings API. Explicit `SOCIAL_MANAGER_ENABLED=false` and `SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false` remain deployment-level kill switches even after settings are persisted. These switches are one-way: explicit environment `false` overrides persisted `true`, while environment `true` does not force a persisted disabled setting on. The publishing environment flag is also always checked directly as an independent master gate.

### Cost and retry controls

The initial persisted defaults are:

- INR 5,000 monthly AI budget threshold.
- Two retries after the initial generation attempt.
- Three compliance-directed content revisions and three image attempts where those stage-specific caps apply.

The Social Manager has no request-count window, hourly/daily generation cap, or daily image-generation cap. Those legacy count fields are removed from the `social_media_manager` settings and the admin UI. The monthly check must include recorded text and image usage; configure reviewed rates where the application estimates cost and keep provider-side budgets and alerts as the authoritative spend control. `SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE` is deliberately mandatory and positive in production so a paid image call cannot enter the ledger at zero cost. The `0.20` example is a conservative ceiling for the configured portrait image through high quality, not a timeless provider price; compare it with the current official OpenAI pricing before each release and never lower it below the maximum quality operators can select. Retry caps bound one workflow attempt; authentication, CSRF, idempotency, and the monthly currency budget remain enforced.

### Creative configuration

| Variable | Requirement | Behavior |
| --- | --- | --- |
| `SOCIAL_MANAGER_IMAGE_PROVIDER` | Required (`openai`) | Full-AI generation rejects another provider or `none` |
| `SOCIAL_MANAGER_IMAGE_MODEL` / `OPENAI_SOCIAL_IMAGE_MODEL` | Required | Model used to generate the actual original visual |
| `SOCIAL_BRAND_LOGO_PATH` | Optional | Explicit path to the exact canonical `pink-paisa-profile-badge-v1` PNG. Any other checksum, dimensions, format or missing alpha channel fails before a paid image request. |
| `PUBLIC_MEDIA_BASE_URL` | Required for publishable output | Determines the public URL recorded on every rendered asset |

Every new publishable visual uses the mandatory `pink-paisa-profile-badge-v1` contract. Before spending, the server verifies the 512×512 transparent PNG and SHA-256 `0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9`. OpenAI `images.edit` receives that badge as the sole high-fidelity generation reference. `gpt-image-2` applies high fidelity to image inputs automatically, so its transport intentionally omits the unsupported `input_fidelity` request field while the frozen contract still records the effective `high` policy. Earlier supported GPT Image edit models receive `input_fidelity=high` explicitly. A locked adaptive safe corner is reused across every slide or frame, and independent vision plus deterministic bounding-box checks require one recognizable badge, exact `PINK PAISA`, the registered mark, correct identity/colour, accepted size, no protected-content overlap and no unrelated branding. Sharp never adds a logo fallback.

The default for eligible new creatives remains `FULL_AI_GRAPHIC`, now contract version 3: OpenAI renders the complete artwork and approved ordinary text with the referenced badge; independent validation treats the badge text separately so it is not duplicated. `AI_BRANDED_ARTWORK` produces full-bleed AI artwork with only the referenced badge and no other on-image text. `AI_VISUAL_WITH_EXACT_OVERLAY` uses the same AI-baked badge, then applies only exact approved copy while masking the frozen badge safe box. Authentic product pixels are placed locally after background generation and may not cover the badge. `AI_ARTWORK_ONLY` is historical-only and new requests fail with `BRAND_LOGO_REQUIRED`. Historical v1/v2, artwork-only, scheduled and published assets remain readable without backfill.

### Reviewer notifications

The environment default accepts a comma-separated list:

```env
SOCIAL_MANAGER_REVIEWER_EMAILS=reviewer1@example.com,reviewer2@example.com
```

After the migration has created persisted settings, configure the reviewer list in the Social Manager Settings tab (or authenticated settings API); the persisted list takes precedence over the environment default. When `notifications.notify_on_draft` is enabled, a successfully created draft triggers one review email. An empty list safely skips delivery. Generation continues if notification delivery fails. The current implementation does not send the stored `notify_on_failure` or `notify_on_publish` notification types.

### Instagram publishing

Keep these values disabled for the initial deployment:

```env
SOCIAL_MANAGER_PUBLISHING_ENABLED=false
SOCIAL_MANAGER_AUTO_PUBLISH=false
SOCIAL_MANAGER_PUBLICATION_LEASE_MS=300000
```

The five-minute publication lease prevents concurrent workers from owning the same provider attempt. A stale `VALIDATING` or `CONTAINER_CREATED` attempt before the pre-media-publish checkpoint is safely resumed; a stale `PUBLISHING` attempt after that checkpoint is quarantined as `UNCERTAIN` for manual reconciliation.

Direct publishing additionally requires:

- `INSTAGRAM_APP_ID`
- `INSTAGRAM_APP_SECRET`
- An exact production `INSTAGRAM_REDIRECT_URI`
- A strong `INSTAGRAM_TOKEN_ENCRYPTION_KEY`
- `INSTAGRAM_GRAPH_API_VERSION`
- A connected Instagram professional account
- A granted `instagram_business_content_publish` or `instagram_content_publish` scope
- Optionally, `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` to pin publication to the expected Instagram user ID
- Public HTTPS creative URLs under `PUBLIC_MEDIA_BASE_URL`

Production token storage fails closed without `INSTAGRAM_TOKEN_ENCRYPTION_KEY`. Existing plaintext development connections must be reconnected or encrypted before production publishing.

## Credentials and permissions checklist

### Draft-only production

- [ ] MongoDB URI for an application-scoped database user.
- [ ] Redis URL reachable only from intended application hosts.
- [ ] Strong `JWT_SECRET` and separate `SOCIAL_AUDIT_IP_SALT`.
- [ ] Public `SERVER_URL`, `PUBLIC_APP_URL`, and `PUBLIC_MEDIA_BASE_URL` on the intended HTTPS domain.
- [ ] SMTP username/password and approved sender identity, because production server startup requires SMTP.
- [ ] Named Pink Paisa admin accounts for every editor/reviewer; do not share one login.
- [ ] Service-account write access to `server/uploads/generated/campaigns` and backup access to MongoDB/uploads.

### Staged AI and web research

- [ ] OpenAI project API key scoped and budgeted for this environment.
- [ ] Approved model names in persisted Social Manager settings.
- [ ] Current input/output USD-per-million-token rates configured for the selected models if the in-app monthly threshold will be used; review `SOCIAL_MANAGER_INR_PER_USD` as well.
- [ ] Provider-side usage budget/alerts; current in-app cost estimation is not an authoritative cap.
- [ ] Reviewed research domain allowlist and/or trusted RSS feed list.
- [ ] Organizational approval for sending aggregate/public content context to the AI provider.

### Direct Instagram publishing

- [ ] Meta/Instagram app ID and app secret for the production app.
- [ ] Exact HTTPS OAuth redirect URI registered with Meta.
- [ ] Strong token-encryption key available to both API and worker where needed.
- [ ] Instagram professional account connected as the intended Pink Paisa account.
- [ ] Granted `instagram_business_content_publish` or `instagram_content_publish` permission.
- [ ] Unexpired encrypted access token.
- [ ] Expected account ID pinned with `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` where possible.
- [ ] Public HTTPS creative URLs verified from outside the server.
- [ ] Environment publishing gate and persisted provider setting both enabled only after the controlled readiness check.

Do not request broader Instagram scopes than the existing connection workflow needs.

## Install and migrate

Install backend and frontend dependencies using the existing project workflow:

```bash
cd /home/ubuntu/pinkpaisa/server
npm ci

cd /home/ubuntu/pinkpaisa/frontend-next
npm ci
npm run build
```

From the backend directory, run the Social Manager foundation migration:

```bash
cd /home/ubuntu/pinkpaisa/server
npm run migrate:social-manager
```

The migration:

- Creates or verifies indexes for `AdminSettings` and all eight Social Manager collections.
- Creates or upgrades the `social_media_manager` record to settings version 2 while preserving known brand, campaign, research, schedule, notification, and publishing choices.
- Forces OpenAI text/image providers, the configured social image model, three-attempt limits, deterministic/template fallback off, and mandatory human approval.
- Seeds and activates version 2 prompts separately for external research, daily market analysis, candidates, strategy, format-specific content, compliance, revision, format rewrite, visual brief, image prompt revision, image generation, and final assembly.
- Labels earlier deterministic/template runs, drafts, and assets as legacy and replaces the asset-role index without deleting history.
- Emits a JSON summary and disconnects from MongoDB.

It is designed to be rerun safely. Run it before serving Social Manager traffic so unique idempotency, publication, prompt-version, and audit indexes are present.

## Start the processes

### Local development

The API starts the marketing worker and scheduler in-process by default outside production. A simple local setup is therefore:

```bash
cd server
npm run dev
```

In another terminal:

```bash
cd frontend-next
npm run dev
```

If you prefer the dedicated worker locally, set both `MARKETING_WORKER_IN_API=false` and `MARKETING_SCHEDULER_IN_API=false`, then run:

```bash
cd server
npm run worker:marketing
```

Do not intentionally run duplicate marketing agent loops. The scheduler has in-process single-flight protection and a heartbeated Mongo lease, but the clean operating model is one scheduler owner.

### Production

The provided PM2 ecosystem runs three processes:

- `pinkpaisa-server`
- `pinkpaisa-marketing-worker`
- `pinkpaisa-frontend`

Keep these production values:

```env
MARKETING_WORKER_IN_API=false
MARKETING_SCHEDULER_IN_API=false
```

Then apply the configuration:

```bash
cd /home/ubuntu/pinkpaisa/server
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

The existing marketing worker also owns the Social Manager scheduler. Each scheduler tick:

1. Enforces an in-process single-flight tick and acquires/heartbeats the shared Mongo scheduler lease.
2. Queues the daily social run when the configured Asia/Kolkata time has passed.
3. Reclaims expired generation leases and processes one pending generation run.
4. When the publishing master gate is enabled, reconciles checkpointed successes and recovers expired publication leases.
5. Processes up to three due schedules, durable `QUEUED` intents, or retriable `FAILED` publications when the publishing master gate is enabled.

The default scheduler poll interval is 30 seconds through `MARKETING_SCHEDULER_POLL_MS`. `MARKETING_SCHEDULER_LEASE_MS` defaults to 20 minutes, is clamped to at least three poll intervals/60 seconds, and is heartbeated while a tick is running.

## Initial verification

Run automated checks before enabling any provider write:

```bash
cd /home/ubuntu/pinkpaisa/server
npm test

cd /home/ubuntu/pinkpaisa/frontend-next
npm run lint
npx tsc --noEmit --incremental false
```

Verify the deployment:

1. Check `GET /api/health` and confirm MongoDB is `connected`.
2. Confirm Redis is reachable with `redis-cli ping` in production.
3. Confirm PM2 shows both the API and marketing worker online.
4. Open `Admin > Growth & Reporting > Social Media Manager` as an administrator.
5. Review the Today readiness banner. Publishing remains blocked by default; missing OpenAI text/image access is a generation error, not a fallback warning.
6. Generate today's recommendation. A new request normally returns HTTP 202 and the UI polls for the completed draft.
7. Confirm the result contains one primary recommendation, exactly two alternatives, rejected ideas, a score, compliance state, and a creative.
8. Open the creative URL directly. It must resolve from the public domain and, before publishing, over HTTPS.
9. Inspect Research and Audit. AI-generated evergreen content can validly state that timely evidence was weak; current claims must have validated sources.
10. Submit for review and approve only after manually inspecting the exact-copy creative. With publishing disabled, the Publish button remains blocked.

## Research operating modes

The runtime chooses research in this order:

1. If research is disabled, no external research is collected.
2. If the resolved provider is `openai_web` and `OPENAI_API_KEY` exists, OpenAI web search runs and only URLs present in tool evidence are accepted.
3. If web research is unavailable or yields no validated signal, configured trusted RSS feeds run.
4. If feeds fail or return no usable signal, AI may recommend an evergreen opportunity and must state that evidence is weak; code does not substitute authored evergreen copy.

With the shipped defaults, `research.provider=AUTO`, `SOCIAL_MANAGER_WEB_SEARCH_ENABLED=false`, and trusted feeds enabled, so trusted RSS is preferred. To enable OpenAI web research:

1. Set `OPENAI_API_KEY`.
2. Set `SOCIAL_MANAGER_WEB_SEARCH_ENABLED=true` as the environment default.
3. Through the authenticated settings API, set persisted research to `enabled=true`, `web_search_enabled=true`, and provider `OPENAI_WEB_SEARCH` (or `AUTO`). Persisted migration defaults otherwise keep web search off.
4. Optionally set a narrow `research.allow_domains` list in the Settings tab.
5. Restart the API and worker after changing environment values.

An empty allowlist permits any HTTPS domain that is not blocked or private by hostname checks. A narrow allowlist is recommended for production finance and wellness claims.

## Controlled publishing activation

Publishing has two independent master gates: an environment flag and persisted admin settings. Both must be enabled. The Settings screen intentionally does not expose the master provider switch.

1. Back up MongoDB and `server/uploads`.
2. Complete the Instagram OAuth connection from the existing Instagram admin controls.
3. Verify the username, professional account type, publishing scope, token expiry, and token-encryption status.
4. Set `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` to the intended Instagram user ID when possible.
5. Set `SOCIAL_MANAGER_PUBLISHING_ENABLED=true` while keeping `SOCIAL_MANAGER_AUTO_PUBLISH=false`.
6. Restart the API and worker with `pm2 startOrReload ecosystem.config.cjs --update-env`.
7. Through an authenticated admin API client, update the persisted master setting:

```http
PUT /api/social-media-manager/admin/settings
Content-Type: application/json
X-CSRF-Token: <current signed CSRF token>

{
  "settings": {
    "publishing": {
      "enabled": true,
      "provider": "INSTAGRAM_GRAPH",
      "auto_publish": false
    }
  }
}
```

8. Generate or open a controlled single-image draft, review all sources and exact copy, submit it, and approve the current revision. For affiliate content, confirm the displayed product ID/title and `/product/<slug>` destination still identify the active, visible, unarchived, compliant, rights-cleared catalog record with a nonempty affiliate URL.
9. Check `GET /api/social-media-manager/admin/drafts/:id/publishing-readiness`. Do not continue until `ready` is `true` and `blockers` is empty.
10. Publish one controlled post with **Publish now**, or schedule it a few minutes ahead and watch the worker logs. **Publish now** returns HTTP 202 after queuing a durable intent; it does not wait for or assert Instagram success.
11. Refresh the draft until its publication reaches `PUBLISHED`, then verify the stored Instagram media ID and permalink on the intended account before wider use. Treat `FAILED` and `UNCERTAIN` as failures, not delayed success.

All Social Manager API calls require an authenticated administrator. Cookie-authenticated writes also require the signed CSRF token used by the existing frontend.

Supported publishing formats are:

- `CAROUSEL`, with three to seven active AI-generated assets (legacy packages may remain within the Meta platform's wider two-to-ten limit).
- `SINGLE_IMAGE`, `INFOGRAPHIC`, `MEME`, `QUIZ`, and `POLL`, each with exactly one active asset.

The installed adapter blocks `REEL` and `STORY` publication. Those packages remain editable and exportable.

Scheduling an approved draft is explicit publication intent. The worker publishes a due `SCHEDULED` draft whenever the master publishing gate is enabled, even while `auto_publish` is false. The `auto_publish` flag never approves content and the current implementation does not turn a newly generated draft into a scheduled post automatically.

## Failure recovery

| Symptom | What the system does | Operator action |
| --- | --- | --- |
| Generate returns 202 but no draft appears | Run remains `PENDING` or `RUNNING`; an expired 15-minute lease is reclaimed | Confirm `pinkpaisa-marketing-worker` is online, inspect PM2 logs, and wait for the next scheduler tick |
| Generation provider fails | Transient run failures return to `PENDING` with bounded exponential retry; exhaustion produces an explicit failed run and no completed draft | Inspect Today run status and Audit; retry only after fixing the cause and checking cost limits |
| OpenAI is absent or unavailable | Generation fails closed; no deterministic draft or template-only creative is created | Restore the key/model access and deliberately retry |
| Partial hooks/caption/visual regeneration is blocked | Those operations require OpenAI; exact-copy rendering and manual editing remain available | Edit manually, render the creative, or restore OpenAI configuration |
| Research has no valid source | Trusted RSS is tried, then evergreen mode | Check feed JSON and worker logs; do not add a current claim without a validated source |
| Image generation is exhausted | Run becomes `FAILED_IMAGE_GENERATION`; any retained partial draft remains failed and cannot be approved | Review the image prompt/provider error, then use the independent image retry action |
| Creative status is `FAILED` or `STALE` | Review/approval is blocked when no validated original AI visual and final composed asset exist | Correct copy or media configuration and regenerate the image/final composition |
| Publishing readiness is false | No Instagram adapter call occurs and a `PUBLISH_BLOCKED` audit event is recorded | Fix every returned blocker instead of repeatedly pressing Publish |
| Publish returns HTTP 202 and remains `QUEUED` | The request persisted an immutable publication intent; the worker has not completed the provider call | Confirm the worker and publishing gate are healthy, then follow the publication and Audit state until `PUBLISHED`, `FAILED`, or `UNCERTAIN` |
| Publish fails with a retriable error | Publication is `FAILED`, retains provider checkpoints, and gets `next_retry_at` until `max_attempts` | Keep the worker healthy; monitor the next attempt and avoid creating a second draft for the same payload |
| A lease expires in `VALIDATING` or `CONTAINER_CREATED` | The worker marks the attempt `FAILED` with an immediate retry time and safely resumes from the stored pre-publish checkpoint | Leave the original publication record in place and let the worker reclaim it |
| A lease expires in `PUBLISHING` | The pre-media-publish checkpoint was crossed, so the worker quarantines the publication as `UNCERTAIN` and disables automatic retry | Check Instagram manually and engage the application owner for reconciliation; the admin UI has no force-retry or resolve-uncertain action |
| Publish outcome is `UNCERTAIN` | Automatic retry stops to prevent a duplicate post | Check the Instagram account and Graph API state manually, record the result, and reconcile before any new attempt |
| Publication is `PUBLISHED` but the draft is not | A real media ID was checkpointed before the worker was interrupted | Keep the worker running; its next pass reconciles the draft to `PUBLISHED` without another provider call and records `PUBLISH_RECONCILED_FROM_CHECKPOINT` |
| Readiness reports `publish_retry_limit_reached` | The publication used its configured `retry_limit + 1` attempts | Fix the provider problem, preserve the original intent, and use a deliberately reviewed duplicate draft only when a new publication is appropriate |
| Reviewer email is missing | Draft generation still succeeds | Verify reviewer list and SMTP logs; notifications are not a publication control |

Generation retries default to three total attempts. Publication defaults to three retries after the initial attempt (four total attempts), with exponential delay capped at six hours. These values come from persisted settings.

## Monitoring and data checks

Monitor:

- `pm2 status`
- `pm2 logs pinkpaisa-marketing-worker`
- `pm2 logs pinkpaisa-server`
- `/api/health`
- Today generation run `status`, `current_stage`, `last_error`, `retry_count`, and `next_retry_at`
- Draft `creative_readiness`, `compliance`, and lifecycle status
- Publication `status`, `attempt_count`, `max_attempts`, `next_retry_at`, `lease_owner`, `lease_expires_at`, `heartbeat_at`, provider checkpoint, media ID, and permalink
- Audit events for blocked, failed, approved, scheduled, and published actions

Social audit and metric records are append-only/immutable through the Mongoose application layer. Back them up with the rest of MongoDB. There is no automatic Social Manager retention or purge job.

## Rollback

### Immediate safe stop

1. Set `SOCIAL_MANAGER_PUBLISHING_ENABLED=false` and `SOCIAL_MANAGER_AUTO_PUBLISH=false`.
2. Restart both API and worker with updated environment values.
3. Update persisted settings back to:

```json
{
  "publishing": {
    "enabled": false,
    "provider": "DRAFT_ONLY",
    "auto_publish": false
  }
}
```

4. If a publish crossed the `PUBLISHING` pre-media-publish checkpoint, inspect Instagram before retrying or deleting anything. A stale `VALIDATING` or `CONTAINER_CREATED` attempt is safely resumable; a stale `PUBLISHING` attempt is uncertain.
5. Review all `SCHEDULED` drafts. Disabling the master flag prevents publication, but overdue scheduled drafts will become due immediately if the flag is later re-enabled. Reject, edit, or deliberately reschedule them first.

To stop generation as well, update persisted settings to `feature_enabled=false` or `daily_generation.enabled=false`. For immediate containment, setting either corresponding environment value to `false` and restarting the processes is a hard kill switch even when the persisted record says true. Existing drafts and audit history remain readable through the database.

### Application rollback

1. Preserve a MongoDB backup and the full `server/uploads` directory.
2. Stop or reload the worker before changing application code.
3. Deploy the prior application release and restart the three PM2 processes.
4. Leave the Social Manager collections in place. Older code does not need to read them, and retaining them preserves audit and publication evidence.
5. Restore MongoDB only when the rollback explicitly requires a point-in-time restore. A restore can remove later approvals, audit events, metrics, and publication checkpoints, so reconcile Instagram first.

Do not delete Social Manager audit logs or metric snapshots as a rollback mechanism. Do not replace `server/uploads`; generated Social assets share the existing campaign asset directory.
