# Pink Paisa Social Growth Team architecture

Status: production operating model, 2026-08-23

This document describes the Social Media Manager that is implemented in this repository. It is an extension of Pink Paisa's existing application, not a second dashboard or a separate system of record.

## Runtime topology

```text
Administrator
    |
    v
Next.js 16 / React 19 admin (:3000)
    |
    v
Nginx /api reverse proxy
    |
    v
Express 4 API (:5001) --------------------> OpenAI text and image APIs
    |       |                                Meta Instagram APIs
    |       |                                GA4 Data API / Search Console API
    |       |
    |       +---- local generated media ----> public HTTPS /uploads URLs
    |
    +---- MongoDB <---- PM2 marketing worker and scheduler
                            ^
                            |
                   optional signed n8n triggers
```

Production is the existing Lightsail/Nginx/PM2 deployment:

- `pinkpaisa-frontend` runs the Next.js server on port 3000.
- `pinkpaisa-server` runs Express on port 5001.
- `pinkpaisa-marketing-worker` runs the durable marketing worker and the recurring scheduler.
- MongoDB stores all Social Manager state. Generated media is stored under `server/uploads` and must be backed up with the database.
- `MARKETING_WORKER_IN_API=false` and `MARKETING_SCHEDULER_IN_API=false` keep scheduling ownership out of the API process in production.

The worker uses a Mongo-backed scheduler lease and in-process single-flight guard. A second PM2 worker, a second active scheduler, or n8n must not be introduced as an uncoordinated competing owner.

Version 3 uses the weekly team as its automatic content-production model. Automatic daily draft generation is disabled by default (`SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false`) so it does not create a parallel stream beside the approved weekly plan. Manual Studio generation remains available, and an administrator can deliberately re-enable the legacy daily schedule later; doing so does not bypass weekly publication capacity or approval.

## Product surfaces

The admin workspace is divided into nine primary views:

1. Connections
2. Weekly Strategy
3. Research Desk
4. Creative Studio
5. Approval Queue
6. Calendar
7. Published & Analytics
8. Community Inbox
9. Settings

Audit history is available as contextual detail within the creative/review workflow rather than as a tenth primary product area.

The authenticated API lives under `/api/social-media-manager/admin`. The signed service-to-service orchestration API lives under `/api/social-media-manager/orchestration`. Admin routes use the existing Pink Paisa administrator authorization chain. Orchestration routes do not use an admin browser session; they require a fresh HMAC signature and an idempotency key.

## Durable data ownership

MongoDB remains authoritative even when n8n is enabled. The important aggregates are:

| Record | Responsibility |
| --- | --- |
| `SocialWeeklyPlan` | IST week, research/supervision provenance, at least eight candidates, selected posts, schedule, approval and production state |
| `SocialGenerationRun` | AI stage attempts, models, provider response IDs, cost metadata, compliance/image failure and retry state |
| `SocialPostDraft` | Current format-specific package, verified product facts, revisions, approval, scheduling and publication pointers |
| `SocialAsset` | Original AI visual, final composed asset, provenance, validation, usage rights and active revision |
| `SocialResearchSource` | Retrieved source, validation status, freshness, safety and source classification |
| `SocialPublication` | Payload-locked publish intent, idempotency, Meta checkpoints, retry lease and final provider outcome |
| `SocialMetricSnapshot` / `SocialGrowthSnapshot` | Immutable Instagram and aggregate GA4/Search Console learning snapshots |
| `SocialOrchestrationReceipt` | Endpoint-scoped idempotency key/body binding, globally unique signed-delivery fingerprints, execution lease, attempts and the exact replayable HTTP result |
| `SocialConnectionHealth` | Redacted health/capability result for each external connector |
| `SocialCommunityItem` / `SocialManualAction` | Inbound engagement, AI recommendation, human decision, provider action or required manual follow-up |
| `SocialAuditLog` / `SocialPromptVersion` | Actor/action trail and versioned AI instructions |

n8n exports never read or write MongoDB. They call first-party endpoints; the Express services enforce leases, deduplication, approvals, business limits and persistence. Before an orchestration operation runs, Express atomically creates or claims a Mongo receipt. A completed duplicate receives the stored status/body, an active duplicate receives `409` with `Retry-After`, and the same endpoint/key with a different exact body receives `409`. Retryable server failures may reclaim that receipt; deterministic client failures are replayed without rerunning the operation. A process crash after a downstream write but before the receipt result is persisted remains an at-least-once recovery boundary, so plan/snapshot generation keys and other downstream business idempotency still matter.

## Weekly operating flow

1. The scheduler or signed n8n endpoint requests a plan for the applicable Asia/Kolkata week. It does not also request an automatic daily draft under the version 3 default.
2. The server reuses an existing idempotent plan where appropriate rather than creating a parallel plan.
3. The research and audience stages combine approved internal signals, configured current research, aggregate GA4/Search Console information and prior aggregate social performance.
4. The AI produces at least the configured candidate count (default eight). Candidates retain evidence and role/model provenance.
5. The AI supervisor selects no more than the configured feed-post maximum (default three) and assigns format/timing recommendations.
6. A human administrator approves or rejects the weekly plan.
7. Prepublication processing creates the selected draft only when its configured lead window is due.
8. Content, compliance/revision and visual brief remain distinct stages. Protected formats retain an original AI image plus final exact-copy composition; native-v2 formats retain the byte-preserving provider original plus resize/encode-only normalized image and no-overlay passthrough final.
9. A human reviews the current revision and active assets before scheduling or publishing.
10. The worker owns the durable publication intent and records the real Meta media ID/permalink or a transparent failure/uncertain outcome.
11. Scheduled metric snapshots and aggregate growth snapshots feed subsequent weekly analysis.

### Weekly maximum is a business invariant

The weekly feed maximum is not an HTTP rate limit. The current default is three non-Story Instagram feed posts per Asia/Kolkata week, with the server accepting only its configured bounded range. It is enforced during weekly-plan validation and again against scheduled, publishing and published feed drafts. Stories are excluded under the current rule. A rejected HTTP request, a retry, a regenerated draft or an n8n execution does not consume a publication slot by itself, and no automation may bypass the invariant.

Per the administrator directive, there is no Social Media Manager or Instagram-integration request-count throttle and the former `Too many Social Media Manager requests. Please wait a bit and try again.` behavior must not be restored. This does not remove authentication, HMAC freshness, idempotency, worker leases, provider quotas, retry ceilings, cost controls or the weekly publication invariant.

## AI and creative boundaries

- Strategy, format choice, format-specific copy, compliance/revision, visual direction and original artwork are AI-generated.
- There is no deterministic evergreen-copy fallback and no template-only completed visual fallback.
- Weak timely evidence can cause the AI to choose a clearly labelled evergreen opportunity; application code still does not author the content.
- Code-based image composition is intentionally limited to deterministic production work such as exact approved text, logo, disclosure, crop, safe area and export. Both the original AI visual and final composed asset are retained. For a product creative, OpenAI receives only the AI-authored text-free/product-free background brief; the service reloads the verified Product record, stores its exact guarded source bytes, and places that authentic image once with Sharp before applying the same exact-copy overlay. The AI background, authentic reference and composite checksums remain independently traceable.
- Invalid structured output, exhausted compliance revision and exhausted image retries remain visible failed runs. They do not create a completed draft.
- Product posts use verified catalog IDs, titles, URLs and available facts. The AI must not invent prices, ratings, stock, discounts, delivery claims or product performance. A database/reference mismatch, unsafe download, invalid image signature/checksum or failed local composite is a visible terminal failure; there is no template or deterministic visual fallback.

## Human-control boundaries

Human approval is required at two separate levels:

- weekly plan approval before selected posts enter production;
- current draft revision and active-asset approval before publication.

Editing or regeneration invalidates stale approval where the approved payload changes. HTTP 202 from Publish now means that a durable intent was accepted, not that Instagram published it. Only a stored `PUBLISHED` state with a real Meta identifier is success.

For video publishing, `VIDEO_FEED` is an internal format/intent. Both `REEL` and `VIDEO_FEED` are transported through Meta's current `REELS` container with `media_type=REELS` and `share_to_feed=true`, while their distinct internal format is preserved for planning, assets, analytics, and audit. `STORY` uses `media_type=STORIES` without feed caption or `share_to_feed`. This mapping avoids inventing an unsupported legacy `VIDEO` container while keeping the AI planner's format decision intact.

Community responses follow recommend -> approve/reject -> send. Unsupported provider operations become `social_manual_action_required`; they must not be presented as sent. Auto-reply and auto-DM default off and, even if enabled later, may send only an already human-approved recommendation. Auto-hide-spam defaults off and is limited to non-escalated items classified as spam with at least 0.90 confidence. Financial, sensitive, medical, complaint, abuse and escalation classes are deterministically escalated regardless of model output.

## Connection boundaries

| Connection | Implemented role | Important boundary |
| --- | --- | --- |
| OpenAI | Structured role outputs and original image generation | Provider failure remains explicit; provider budgets and current model pricing must be configured independently |
| Instagram Login | Current first-party OAuth path, professional profile, supported publishing/insights/community capabilities | No ads or tagging family; availability still depends on granted scopes and account type |
| Facebook Login | Modelled capability family | The repository does not currently provide the complete first-party Facebook Login OAuth/Page-token connection flow; treat it as unavailable until implemented and reviewed |
| GA4 | Read-only aggregate Data API signal | Exact property access and live health must be verified; never send user-level data to AI |
| Search Console | Read-only aggregate Search Analytics signal | Property string must match the verified domain or URL-prefix property |
| n8n | Optional trigger/notification transport | Not a database, approval engine, content generator or publication owner |
| RSS/current research | Configured evidence input | All external text is untrusted and subject to source validation and prompt-injection controls |
| Meta Hashtag Search / Business Discovery | Official, capability-gated public conversation signal | Facebook Login with a linked Page and eligible professional accounts is required; the current Instagram Login connection reports these operations unavailable. Approved watchlists persist only abstract patterns and public aggregate indicators, never copied captions or creatives. |

## Optional n8n role

Version-controlled exports are in `deploy/n8n`. They are inactive on import and contain no credential values. When deliberately enabled, they call only the signed first-party orchestration endpoints:

- `POST /api/social-media-manager/orchestration/weekly-plan`
- `POST /api/social-media-manager/orchestration/prepublication`
- `POST /api/social-media-manager/orchestration/metrics`

Every request carries an epoch-seconds timestamp, `X-Idempotency-Key`, and a versioned `X-Pink-Paisa-Signature`. Version 1 signs a canonical LF-delimited envelope containing the fixed context `pink-paisa-social-orchestration/v1`, `POST`, the exact allowlisted orchestration path, its canonical operation, the exact idempotency key, timestamp, and exact raw JSON bytes. The header is `v1=sha256=<lowercase HMAC-SHA256 hex>`. Changing the method, path/operation, key, timestamp, or body invalidates the signature; the legacy `sha256=<timestamp.body digest>` envelope is rejected.

After verification, the server also derives a fingerprint from the verified timestamp, normalized signature and exact body, and stores it through a globally unique Mongo index before executing. This second durable layer blocks reuse of an already verified signed delivery even if a future routing/integration defect bypasses the primary canonical binding. HTTPS remains mandatory because HMAC authenticates but does not encrypt request content.

The signed weekly endpoint always uses ordinary reuse semantics and rejects `force:true`. Only an authenticated administrator may deliberately force a weekly-plan reset. The metric export uses a bounded three-attempt retry with the same signed delivery and key: a stored success is replayed, a stored retryable server failure is reclaimed, and a still-active lease remains a `409` state conflict rather than a request throttle.

The built-in PM2 scheduler is the default and only schedule owner while `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true`. Activate the reviewed n8n schedule workflows only after setting that flag to `false` and reloading the worker. The gate stops only internal weekly-plan, prepublication, Instagram-metric and aggregate-analytics scheduling; the worker must remain online for durable AI/publication queues and unrelated jobs. Never run both schedule owners.

## Observability and health

- `GET /api/health` reports Express/Mongo readiness and returns 503 when MongoDB is disconnected.
- PM2 must show all three named processes online; inspect API and marketing-worker logs separately.
- Connections -> Check connections performs real, redacted connector checks. `CONFIGURED` is not equivalent to `CONNECTED`.
- Weekly plans, runs, drafts, assets, publications, metric snapshots, manual actions and audit entries are the operational evidence. n8n execution success alone is never proof that a plan was approved, a post was created or Instagram published.
- An `UNCERTAIN` publication is never automatically retried after the provider-side publish checkpoint; reconcile it against Instagram manually.

## Primary references

- Express security guidance: https://expressjs.com/en/advanced/best-practice-security.html
- Mongoose transactions: https://mongoosejs.com/docs/transactions.html
- MongoDB unique multikey indexes: https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/
- PM2 ecosystem files: https://pm2.keymetrics.io/docs/usage/application-declaration/
- Meta's official Instagram API collection: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Instagram API with Instagram Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
- GA4 Data API quickstart: https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
- Search Console Search Analytics query: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- n8n Schedule Trigger: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/
- n8n Webhook node: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- n8n HTTP Request node: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
