# Pink Paisa Social Media Manager implementation plan

> Historical foundation plan: its optional-AI, deterministic-evergreen, and template-only fallback decisions are superseded by [the fully AI correction plan](fully-ai-social-manager-correction-plan.md). Do not use those legacy fallback sections as the production contract.

Status: approved implementation baseline

Prepared: 22 August 2026

Timezone contract: `Asia/Kolkata`

## 1. Executive summary

Pink Paisa already has a production-grade, product-centric Instagram campaign pipeline. It includes protected admin operations, Mongo-backed worker tasks, image providers, generated media storage, review and scheduling controls, a Meta/Instagram connection, resumable publishing, click tracking, and operational logging. That infrastructure should be reused.

The existing pipeline cannot represent the requested daily editorial decision. A product campaign has one product-shaped brief and one generated post; it does not store five candidate ideas, a primary recommendation and alternatives, research evidence, prompt versions, field-level edit history, broad content pillars, duplicate analysis, or immutable performance snapshots. The implementation will therefore add a dedicated social-strategy domain and bridge approved social drafts into the existing media and Instagram publishing services.

The default mode will remain useful without external credentials: it will collect verified internal signals, use trusted evergreen logic when current research or AI is unavailable, create a validated draft and programmatic creative preview, and require human review. Direct publishing will be disabled by default and cannot bypass approval.

## 2. Architecture discovered

### Application stack

- Active frontend: Next.js 16.2, React 19.2, TypeScript, Pages Router, under `frontend-next/`.
- Backend: Node.js 20-compatible CommonJS, Express 4, Mongoose 8, under `server/`.
- Database: MongoDB through Mongoose. There is no formal migration framework; production changes use idempotent scripts under `server/scripts/`.
- Deployment: AWS Lightsail with Nginx and PM2. PM2 runs the Express API, Next.js server, and a dedicated marketing worker.
- Background processing: Mongo-backed `AgentTask` lanes with leases, heartbeats, idempotency keys, stale-task recovery, and a distributed `SchedulerLease`. Redis may support unrelated platform features such as temporary daily-prediction state, but it is neither the Social Manager queue nor a Social Manager request throttle.
- Media: local files under `server/uploads`, served from `/uploads`, with public URL construction, path guards, checksums, and backup instructions. Generated campaign assets are stored outside MongoDB binaries.
- Tests: backend uses Node's built-in `node:test`. Frontend lint and production build are configured; a dormant Vitest test exists but the Vitest dependencies and script are absent.
- CI/observability: no repository CI workflow. Logging is structured JSON with request IDs and secret redaction; health, worker heartbeat, queue depth, and failures are available, but no hosted APM is configured.

### Security and authorization

- Server-side `protect` plus `adminOnly` middleware is the authorization boundary for admin routes.
- Admin sessions use secure HTTP-only cookies in production, session-version validation, lock checks, CSRF protection for unsafe cookie-authenticated requests, strict CORS, and security headers.
- Instagram OAuth state is signed and short-lived. Stored Meta/Instagram tokens are encrypted with AES-256-GCM in production.
- User roles are currently only `user` and `admin`; there are no separate reviewer, approver, or publisher roles. Phase 1 will treat an authenticated admin as the authorized reviewer while recording the individual actor in the audit log.

### Existing domain data

- `Product` is the canonical public catalog for admin, vendor-synced, and affiliate products. It already stores active/visible state, taxonomy, campaign labels, media, affiliate URL/tag/ASIN/marketplace, data freshness, image rights, compliance, link health, and Instagram-pick flags.
- `ProductCategory` and `ProductSubcategory` provide taxonomy.
- `Blog`, `Workshop`, `WorkshopSession`, `VirtualProduct`, and `Poll` provide additional internal content signals.
- The Wealthness Quiz and EMI/SIP/lump-sum calculators are source-controlled frontend resources rather than database entities.
- `AffiliateEvent` records product views, CTA clicks, outbound clicks, UTMs, bot flags, and privacy-preserving hashes. Admin analytics also aggregates commerce, workshop, poll, blog, affiliate, and imported Amazon report data.
- Product eligibility must be evaluated with explicit active, visible, categorized, compliant, rights, link-health, and freshness rules. Direct slug endpoints are not a sufficient verification source.

### Existing Instagram campaign system

- `MarketingCampaignRun`, `AgentTask`, `DailyBatchRun`, `MarketingAsset`, `MarketingPublishAttempt`, `MarketingCampaignPublishEvent`, and `MarketingWorkerHeartbeat` form the current product-promotion pipeline.
- Existing capabilities to reuse include queue leases, retries and stale recovery, public media readiness, review actions, scheduling, durable publishing checkpoints, uncertain-outcome quarantine, idempotent Meta publishing, permalink/media ID persistence, and a detailed admin timeline.
- Existing AI campaign stages are product focused. The current automatic sequence skips its legacy strategy stage and does not research today's market, generate five broad editorial candidates, explain “why today,” or compare 60-90 days of content.
- Existing product campaign autopilot can direct-publish in some modes. The Social Media Manager will not inherit that behavior.

### Live-site findings on 22 August 2026

- The production homepage and `/api/health` respond successfully; MongoDB reports connected.
- The public catalog contains 87 products, all affiliate products. There are no non-affiliate catalog products, featured products, or products currently marked as Instagram picks.
- Current catalog distribution is Beauty and Self Care (24), Fitness (24), Healthy Lifestyle (24), and Sleep and Recovery (15).
- `/instagram` can show the general catalog, but `/instagram/picks` and `/instagram/trending` are empty. Blogs, workshops, and the current predictions set are also empty.
- The sitemap exposes the homepage, products, wellness, Instagram routes, quiz, calculators, blogs, workshops, Pink Pages, predictions, and 87 product pages.
- The curated `/wellness/{haircare,natural-beauty,skincare,instagram-picks}` pages currently fail client rendering because function-valued matchers are passed through `getServerSideProps` and become undefined. This narrow landing-page bug is in scope because the decision engine must never recommend a broken destination.
- Production brand copy and styles confirm “Wealth | Wellness | Women,” DM Sans body text, DM Serif Display headings, warm cream/rose/sage tokens, a premium conversational voice, and the existing Pink Paisa wordmark.

## 3. Components to reuse

- Authentication, CSRF, CORS, request IDs, logger, and error middleware.
- `Admin.tsx` shell, `apiFetch`, error boundary, shared admin components, Radix/shadcn primitives, Lucide icons, Sonner notifications, and existing responsive layout conventions.
- Product eligibility and affiliate compliance utilities; active content models and aggregate `AffiliateEvent` analytics.
- Trusted RSS research protections from `dailyPredictionService`: HTTPS/host checks, DNS/private-IP blocking, redirect limits, timeouts, body limits, freshness checks, and cross-source/primary-source handling.
- Mongo task leases, scheduler ownership, stale-task recovery concepts, and PM2 worker deployment.
- Image provider registry, campaign media storage, Sharp/SVG overlay technique, upload endpoint, checksum/provenance conventions, and campaign creative lightbox patterns.
- Instagram connection and publishing services, including content quota checks, single-image/carousel containers, polling, resumable checkpoints, and durable media IDs/permalinks.
- SMTP email service for reviewer notifications.
- Existing UTM capture and affiliate event tracking for landing-page performance.

## 4. Proposed architecture

The new social domain will live beside, rather than inside, the existing product campaign domain.

1. A scheduler or an authorized admin starts a `SocialGenerationRun` with an idempotency key for the IST date and trigger.
2. `SocialInternalSignalCollector` queries verified internal resources and aggregate performance only. It excludes customer PII and inactive or unverified offers.
3. A `SocialResearchProvider` collects current evidence when enabled. The OpenAI web-search adapter will treat pages as untrusted data and persist only validated source metadata. Trusted RSS is the fallback; evergreen mode is the final fallback.
4. `SocialStrategyProvider` produces at least five bounded candidates. Deterministic scoring, compliance, rotation, source, and duplicate checks remain authoritative.
5. Separate copy, compliance, visual-direction, and assembly stages use strict JSON schemas. Every stage is versioned and usage is recorded. If AI is unavailable or a budget limit is reached, deterministic evergreen candidates and templates still create a usable draft.
6. A validated `SocialPostDraft` stores the primary recommendation, two alternatives, rejected ideas, concise rationale, source references, and editable fields.
7. `SocialCreativeService` optionally generates a text-free base image, then always applies the exact approved copy, logo, brand palette, safe areas, and output dimensions programmatically. A no-cost brand template is the default preview.
8. Admins edit, submit, approve or reject, schedule, and publish through explicit lifecycle transitions. Every mutation creates a field-level `SocialAuditLog` entry.
9. `SocialPublishingProvider` runs readiness checks and delegates approved feed images/carousels to the existing Instagram publisher. The draft-only provider is used when publishing is disabled or credentials are missing.
10. Immutable `SocialMetricSnapshot` records manual or provider-imported performance. Future scoring uses correlations as weak signals and applies diversity caps.

## 5. Database changes

Mongoose models will use nearby marketing conventions (`snake_case`, `created_at`/`updated_at` where practical) and idempotent indexes.

### `SocialGenerationRun`

- IST date, timezone, trigger type, idempotency key, status, and current stage.
- Prompt/model/provider versions per stage.
- Input snapshot hash, aggregate internal-signal summary, research mode/fallback status, usage/tokens/cost estimate, retry count, and errors.
- Candidate summaries, selected draft reference, start/finish times.

### `SocialPostDraft`

- Lifecycle: `DRAFT`, `NEEDS_REVIEW`, `APPROVED`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `REJECTED`, `FAILED`.
- Generation date and run reference.
- Strict validated result package: primary, two alternatives, rejected ideas, scores, concise rationale, copy for every supported format, disclaimers, destinations, UTMs, sources, confidence, and risk flags.
- Current editable package, revision number, duplicate analysis, compliance summary, creative readiness, schedule, publication result, and failure state.
- Approval remains explicit; generation never sets approved status.

### `SocialResearchSource`

- Generation/draft references; source title, URL, normalized domain, publisher, publication/access dates, excerpt/summary, supported claim, confidence, freshness, source type, validation status, and prompt-injection flags.

### `SocialAsset`

- Draft reference, asset type, slide/frame position, public URL/storage key/checksum, width/height/aspect ratio, base-image provider/model/prompt, overlay data, provenance/rights, validation checklist, and active version.
- No image binaries in MongoDB.

### `SocialPromptVersion`

- Stage, semantic version, prompt hash, schema version, active flag, and safe prompt metadata. Full secrets and hidden reasoning are never stored.

### `SocialAuditLog`

- Draft/run reference, action, actor admin, timestamp, field-level before/after summary, request ID, prompt/model/source metadata where applicable, and error/retry metadata.

### `SocialPublication`

- Draft reference, idempotency key, provider, status, asset/caption fingerprint, attempt count, resumable creation IDs, final media ID/permalink, timestamps, and last sanitized error.

### `SocialMetricSnapshot`

- Draft/publication reference, source and retrieval time, immutable platform metrics, available site conversions, posting time, and notes describing manual/imported provenance.

### Settings

- Reuse `AdminSettings` with a validated `social_manager_settings` object stored under a dedicated key.
- Persist brand profile, audience, pillars and ratios, research allow/block lists, daily/default posting time, model selection, monthly currency budget, per-run retry caps, duplicate lookback, disclaimers, UTM naming, reviewer recipients, feature flags, and approval policy.
- Do not impose a request-count window, hourly/daily generation cap, or daily image-generation cap. Authentication, CSRF, idempotency, retry caps, and monthly spend enforcement remain the operational controls.
- An idempotent migration script will create indexes and seed default prompt/settings records without overwriting admin changes.

## 6. API changes

All routes below are mounted under `/api/social-media-manager/admin` and protected by `protect`, `adminOnly`, CSRF, and validation. There is no dedicated count/time-based Social Manager request limiter.

- `GET /today` - current recommendation, alternatives, readiness, recent run, and connection summary.
- `POST /generate` - idempotent manual generation; optional force creates a new revision lineage while retaining monthly-budget and retry controls.
- `GET /drafts` and `GET /drafts/:id` - calendar/list and full evidence-rich detail.
- `PATCH /drafts/:id` - whitelist-edit strategic and content fields with strict revalidation and audit diff.
- `POST /drafts/:id/regenerate` - scoped regeneration for alternatives, hooks, caption, visual, or fact check.
- `POST /drafts/:id/duplicate` - copy into a new `DRAFT` without copying approval/publication state.
- `POST /drafts/:id/submit-review`, `/approve`, and `/reject` - guarded lifecycle transitions.
- `POST /drafts/:id/schedule` and `/publish` - approval/readiness-gated scheduling and durable publication enqueue; the worker records the final provider outcome in draft/publication state.
- `POST /drafts/:id/assets/render` - render or re-render exact-copy programmatic assets; optional AI base image remains separately replaceable.
- `POST /drafts/:id/metrics` - manual immutable metric snapshot.
- `GET /performance` - cautious learning summaries; research evidence and audit history are included in full draft detail.
- `GET /settings` and `PUT /settings` - validated configuration.
- `GET /drafts/:id/publishing-readiness` - provider/env/Instagram/public-media readiness without exposing secrets.
- `GET /api/instagram/webhook` - fail-closed Meta webhook subscription verification using a timing-safe token comparison.

Responses expose no access tokens, prompt secrets, private user data, or hidden chain-of-thought.

## 7. Admin UI changes

- Add `Social Media Manager` as a distinct section in the existing Growth & Reporting group; retain the product-centric Campaigns screen unchanged.
- Default `Today` view:
  - topic, “Why today?”, objective, format, pillar, audience, score, confidence, risks, sources, landing page, UTM preview, caption, and creative preview;
  - two alternatives with score and selection rationale;
  - sticky lifecycle actions with readiness blockers.
- Editor exposes topic, selected hook and alternatives, slides/story/reel copy, caption, CTA, hashtags, disclaimer/disclosure, landing page, UTMs, visual prompt, alt text, and posting time.
- Research panel shows internal and external signals, source freshness/confidence, influence/exclusion reasons, and prompt-injection/source-validation flags.
- Calendar is an agenda grouped by status and date, with draft, review, approved, scheduled, published, failed, and rejected states.
- Performance view displays immutable snapshots and careful correlation summaries without causal language.
- Settings exposes brand/audience, content mix, scheduling, domains, approval, models, budgets, duplicate lookback, disclosures, UTM rules, and notification recipients.
- Reuse the Instagram connection state and creative preview/timeline patterns. The initial implementation generates editable exact-copy template assets; existing admin uploads can be selected as a future text-free base-image enhancement.
- Add a compact dashboard card linking to today's social recommendation and outstanding reviews.

## 8. AI workflow

Provider contracts:

- `SocialResearchProvider`
- `SocialStrategyProvider`
- `SocialCopyProvider`
- `SocialComplianceProvider`
- `SocialImageProvider`
- `SocialPublishingProvider`
- `SocialAnalyticsProvider`

OpenAI calls use the Responses API with `text.format.type = "json_schema"`, strict schemas, bounded outputs, request timeouts, exponential retries only for transient failures, prompt-cache keys where supported, and usage capture. The configured default text model will follow the existing `gpt-5.6-luna` convention unless an admin selects another supported model.

Prompts are separate and versioned for:

1. market research;
2. candidate generation;
3. strategy and scoring;
4. content writing;
5. compliance review;
6. visual direction;
7. final structured assembly.

No raw research page can alter system instructions, publishing permissions, approval state, database access, brand rules, or safety rules. Only concise business rationale is stored; private reasoning is neither requested nor persisted.

## 9. Research workflow

- Determine the date using `Asia/Kolkata`.
- Collect active internal resources and aggregate performance with explicit eligibility filters.
- Prefer configured trusted/primary sources for financial rules and current claims.
- OpenAI web search is optional and returns source metadata. Returned recommendation sources must match tool-reported URLs before they can be treated as confirmed.
- Trusted RSS can supply current India policy/finance signals using the existing SSRF-safe collector.
- Reject non-HTTPS, private-network, credential-bearing, blocked-domain, oversized, stale, or injection-suspect evidence.
- Persist title, URL, publisher/domain, publication date when available, access timestamp, supporting summary, supported claim, confidence, freshness, and source type.
- A current claim without validated evidence is removed or marked unconfirmed. When the remaining timely case is weak, the engine deliberately uses an evergreen recommendation.

## 10. Decision, duplication, and compliance workflow

- Produce at least five candidates, then apply deterministic scoring:
  - brand relevance 0-25;
  - audience usefulness 0-20;
  - timeliness 0-15;
  - originality 0-15;
  - engagement potential 0-10;
  - business alignment 0-10;
  - evidence quality 0-5;
  - compliance penalty 0 to -30.
- Compare topic, hook, caption, CTA, format, pillar, product, and visual concept with the configured 60-90-day history. Use normalized-token/Jaccard similarity initially and an optional semantic provider when configured.
- Apply content-mix and promotion-fatigue penalties, including existing recent product campaign history.
- Reject unsupported claims, guaranteed outcomes, personalized advice, securities predictions, unapproved health claims, sensitive/insensitive angles, affiliate price/rating/availability/delivery claims, broken destinations, and unsafe or repetitive candidates.
- Select one primary and two alternatives, and persist rejected ideas with concise reasons.
- Finance content receives an educational disclaimer when applicable. Affiliate posts require the configured early disclosure and verified product/URL/rights/compliance state.

## 11. Creative workflow

- Support 1080x1350 feed, 1080x1080 square, and 1080x1920 story/reel-cover canvases plus multi-slide carousel rendering.
- Keep exact copy out of image-generation prompts. AI, when requested, creates only a text-free base image/background/illustration.
- Apply Pink Paisa logo, palette, DM Sans/DM Serif Display-compatible typography, exact approved text, ₹, disclosures, safe areas, and contrast programmatically with Sharp/SVG.
- The default no-credential path creates an editable brand-template preview.
- Regenerating an image does not rewrite copy. Rewriting copy re-renders overlays without paying for a new base image.
- Automated checks validate dimensions/aspect ratio, text bounds, copy/source equality, required brand spelling, ₹ preservation, logo source, contrast estimate, checksum, and public URL readiness. AI-generated or uploaded imagery also requires an explicit human visual review for cultural representation, watermarks, competitor branding, irrelevant imagery, and unsupported visual claims.

## 12. Approval, scheduling, and publishing workflow

- Generation creates `DRAFT` only.
- `DRAFT -> NEEDS_REVIEW -> APPROVED -> SCHEDULED -> PUBLISHING -> PUBLISHED` is the successful path. `REJECTED` and `FAILED` retain history and can be duplicated into a new draft.
- Approval requires a valid structured package, completed compliance pass, valid landing page/UTMs, required disclaimers/disclosures, non-duplicate publication fingerprint, and a validated creative.
- Scheduling requires approval and a valid future IST time.
- Publishing requires approval, a connected professional Instagram account with required scopes, public HTTPS assets, feature flag enabled, quota availability, idempotency protection, and no existing successful/uncertain publication.
- `SOCIAL_MANAGER_PUBLISHING_ENABLED=false` and `SOCIAL_MANAGER_AUTO_PUBLISH=false` are the defaults. The daily job never approves content. Auto-publish remains disabled unless a future explicitly reviewed permission model is added.
- The existing official feed image/carousel publisher is reused. Reel/Story formats can be prepared/exported but are not falsely reported as API-published until a supported adapter is implemented and tested.

## 13. Automation and reliability

- Extend the existing PM2 marketing worker and distributed scheduler rather than creating another service.
- Default daily generation is 08:00 `Asia/Kolkata`, configurable in admin.
- Use a date-based unique idempotency key and a catch-up window so a brief worker restart does not permanently miss the run.
- Temporary research/AI failures receive bounded exponential backoff with jitter. Permanent validation/compliance failures do not retry blindly.
- Research provider failure activates trusted RSS, then evergreen fallback.
- Reviewer notification failure is logged but does not discard a valid draft.
- Scheduled publishing retains the existing uncertain-outcome quarantine: a post that may have published is never retried or shown as successful without reconciliation.

## 14. Performance and learning loop

- Store manual and provider-imported snapshots rather than overwriting metrics.
- Support reach, impressions, likes, comments, saves, shares, video views, completion rate, profile visits, follows, website clicks, landing sessions, affiliate CTA clicks, quiz starts/completions, calculator opens, workshop enquiries, and product visits when available.
- Immediately reuse aggregate AffiliateEvent/UTM data. Do not infer Amazon sales from site clicks; imported Amazon reports remain separate.
- Build weak-signal summaries for pillar saves, hook engagement, format shares, landing traffic, time performance, and audience response.
- Apply diversity constraints so a winning format does not dominate the feed. UI explanations use “associated with” or “influenced by,” never unsupported causal claims.

## 15. Security and privacy

- Admin-only server routes, CSRF, schema validation, output validation, safe URL normalization, SSRF controls, allow/block domains, provider/network timeouts, redirect/body limits, and safe HTML/plain-text rendering.
- Feature flags, human approval, provider readiness, idempotency keys, retry caps, and immutable audits.
- External prompts contain only public content facts and aggregate analytics. They exclude customer emails, phones, addresses, orders, payments, auth/session data, admin identifiers, and secrets.
- Access tokens remain server-side and encrypted; logs use sanitized errors and redacted metadata.
- Source excerpts are bounded and treated as data. Prompt-injection indicators cause exclusion or an explicit risk flag.
- Uploaded/generated media records provenance and usage rights. Large files remain outside MongoDB and continue through current backups.

## 16. Testing plan

Add backend `node:test` coverage with mocked providers for:

- candidate scoring and negative risk penalties;
- duplicate similarity and materially different reuse;
- pillar/promotion rotation;
- strict structured-output validation;
- missing or mismatched sources and unsupported current claims;
- affiliate price/rating/discount/availability restrictions;
- financial disclaimer rules;
- approval/readiness transitions;
- daily idempotency and catch-up scheduler behavior;
- `Asia/Kolkata` date/time handling;
- UTM generation and first-party landing validation;
- image provider failure and template fallback;
- publishing disabled by default, missing permission, idempotency, uncertain outcome, and retries;
- prompt-injection and SSRF resistance;
- admin route authorization and field-level audit creation;
- immutable metric snapshots and cautious learning summaries.

Because this repository does not currently include a runnable frontend unit-test dependency or script, verify the new admin surface with strict TypeScript, targeted ESLint, and the full Next production build. External AI/Meta/image calls are mocked in backend tests; automated tests never use paid APIs.

The final verification gate is:

1. `npm test` in `server/`;
2. social migration syntax/seed verification (execute against the intended deployment database during rollout);
3. `npx tsc --noEmit` in `frontend-next/`;
4. `npm run lint` in `frontend-next/`;
5. `npm run build` in `frontend-next/`.

## 17. Deployment requirements

- Run the idempotent social-manager migration before enabling scheduled generation.
- Deploy API, worker, and frontend together; preserve `server/uploads` and include social assets in existing backups.
- Restart/reload both `pinkpaisa-server` and `pinkpaisa-marketing-worker` with updated environment values.
- Keep public media on HTTPS and confirm Meta can fetch each generated asset.
- Start in draft-only mode, generate one deterministic preview, run a complete review/schedule dry run, and only then test one controlled Meta publication.
- Monitor scheduler lease, social generation run, queue backlog, reviewer notification, publishing attempt, and audit records.
- Restore a repository CI workflow or run the documented verification commands in release automation before deployment.

## 18. Credentials and permissions still required

The implementation can complete and run in draft-only mode without these values. Live capabilities require:

- A real `OPENAI_API_KEY` with access to the configured Responses and image models for AI generation and optional web research.
- A connected professional Pink Paisa Instagram Business or Creator account.
- Meta app ID and secret, production redirect URI, token encryption key, approved `instagram_business_basic` and `instagram_business_content_publish` permissions, and a public HTTPS domain.
- A valid SMTP credential if email reviewer notifications are desired.
- Admin confirmation of allowed/blocked research domains, reviewer recipients, monthly budget, financial disclaimer, affiliate disclosure, content-pillar ratios, and default posting time.
- Optional future Meta insights permissions for automated performance import. Manual metric snapshots remain available without them.

No credential will be committed, returned to the frontend, or logged in full.

## 19. Delivery sequence

### Phase 1

- Models, migration, settings, prompt/schema versions, internal collector, research adapters, daily decision engine, duplicate/compliance checks, structured result, admin Today/editor/research/settings views, draft/review workflow, programmatic creative preview, notifications, tests, and documentation.

### Phase 2

- Scheduling, guarded Instagram provider bridge, durable publication tracking/reconciliation, retries/failure UI, full audit timeline, and export package.

### Phase 3

- Metric snapshots/import provider, existing UTM conversion joins, learning summaries, reporting view, and conservative score influence.

Phase 1 is independently usable with no Meta or OpenAI credentials. Implementation will continue through all locally testable Phase 2 and Phase 3 foundations in this task.
