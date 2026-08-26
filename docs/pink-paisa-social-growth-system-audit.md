# Pink Paisa Social Growth System Audit

Date: 2026-08-23
Scope: `/admin?section=social_media_manager`, its API, workers, storage, deployment, and external social/analytics connections.

> **Pre-implementation baseline:** The detailed findings below record the repository state before the Social Growth Team build began. They are retained as the implementation decision record and must not be read as the current production-capability list.

## Current as-built status

The repository now includes the version 3 weekly operating model, a durable maximum-three-post weekly plan, separately versioned research/audience/planning/growth roles, aggregate GA4 and Search Console ingestion, signed n8n trigger exports, Meta capability health, verified webhooks, the Community Inbox, direct supported-format publishing, and the requested admin information architecture. Human approval remains mandatory; a publish is successful only after a real Meta media identifier is stored, and provider limitations or failures remain explicit rather than simulated.

The current Instagram Login path supports its documented professional-account publishing, insights, and community capabilities. Meta-native Hashtag Search and Business Discovery require the separately documented Facebook Login/Page-token capability path and are shown as unavailable when that path is not configured. Refer to the current [architecture](pink-paisa-social-growth-architecture.md), [Meta setup runbook](pink-paisa-meta-instagram-setup.md), [deployment guide](pink-paisa-social-manager-deployment.md), and [administrator guide](pink-paisa-social-manager-admin-guide.md) for operational truth.

## Executive summary

Pink Paisa already has a substantial AI Social Media Manager foundation: OpenAI Responses-based structured generation, GPT Image generation, exact programmatic text/logo composition, source validation, compliance/revision loops, encrypted Instagram tokens, direct Meta container publishing, human approval, idempotent durable publication records, scheduled background processing, metric snapshots, and an admin workspace.

The repository does **not** use Lovable Cloud, Supabase, Supabase Edge Functions, or a second social dashboard. It is a Next.js/React frontend backed by an Express/Mongoose API, MongoDB, Redis-backed rate-limit support, local/server media storage, PM2 workers, Nginx, and Lightsail deployment scripts. No existing n8n workflow or n8n application integration was found.

The largest gaps are a weekly three-post planning object, separately versioned weekly research/audience/growth roles, GA4 and Search Console ingestion, n8n trigger integration, Meta permission/capability reporting, Meta webhook ingestion and signature verification, broader video/Reel/Story/community operations, a Community Inbox, and a unified connection/performance UI.

This implementation will extend the existing system rather than replace it. External integrations must report truthfully as `CONNECTED`, `DEGRADED`, `NOT_CONFIGURED`, `UNSUPPORTED`, or `ERROR`. No production path may simulate publishing or successful ingestion.

## Repository and architecture findings

| Area | Verified implementation |
| --- | --- |
| Frontend | `frontend-next`: Next.js 16 Pages Router, React 19, TypeScript, Tailwind/shadcn-style components |
| Backend | `server`: Node.js, Express 4, CommonJS services/controllers/routes |
| Database / ORM | MongoDB through Mongoose 8 |
| Authentication | Existing application JWT/session middleware; Social Manager routes use existing authenticated admin middleware |
| Admin authorization | Existing `protect`/admin authorization chain used by admin APIs; lifecycle actions also record actor identifiers |
| Media | Existing generated-asset storage and renderer; Sharp-based exact text/logo composition; public asset URL required by Meta |
| Background work | PM2 API plus marketing worker; recurring scheduler and durable lease/idempotency records; Redis is available to shared infrastructure |
| OpenAI | Existing Responses API structured-output provider and GPT Image workflow; per-stage model settings and prompt versions |
| Instagram | OAuth/state validation, encrypted token storage, connected professional-account identity, single-image/carousel container publishing, polling, exact-once publication workflow |
| Analytics | Social metric snapshots and affiliate/marketing/admin analytics exist; no GA4 Data API or Search Console connector found |
| Internal entities | Products and affiliate-product data are rich; blogs, workshops, polls/predictions and other marketing entities are available but vary in depth |
| Notifications | Existing application email utility can notify reviewers/admins |
| Deployment | Lightsail, Nginx, PM2, deployment archive and backup/rollback documentation |
| n8n | No application connector, workflow exports, or configured scheduler delegation found |

## Existing Social Media Manager functionality

The current implementation already provides:

- AI-created research, candidates, strategy, format-specific copy, visual briefs, compliance, revision, image-prompt revision, image generation and assembly.
- Strict JSON Schema outputs and server-side schema validation for the current stages.
- Prompt-injection-resistant research sanitisation and an authoritative-source allowlist.
- Format-aware generation for single image, carousel and additional content-package concepts; the prompt explicitly forbids defaulting to carousel.
- Original GPT Image invocation followed by deterministic **production composition only**: crop/resize, exact approved copy, logo, safe-area and contrast handling. The renderer is not used as a substitute for AI artwork.
- Product authenticity controls that preserve verified identifiers/assets and prohibit invented prices, reviews, ratings, stock, discounts and delivery claims.
- Compliance decisions, bounded AI revision, visibly failed compliance/image states, and no deterministic caption/content fallback.
- Human review, edit, approve, reject, schedule, publish and regenerate operations with audit logs.
- A durable `SocialPublication` record with idempotency, processing checkpoints, retry/error classification, uncertain-outcome reconciliation and Meta media-ID verification.
- Calendar, research, performance, settings and audit views.

## Existing code to reuse

| Capability | Reusable code |
| --- | --- |
| Structured AI stages | `server/services/social/openAiSocialProvider.js`, `socialSchemas.js` |
| Prompt/source provenance | `SocialPromptVersion`, `SocialResearchSource`, generation run stage records |
| Internal truth | `socialInternalSignals.js` plus Product/affiliate/blog/workshop/prediction models |
| Research safety | `socialResearchService.js`, `socialCompliance.js`, `socialRevisionGuard.js` |
| Decision/copy/creative | `socialDecisionEngine.js`, `socialManagerService.js`, `socialAiImageService.js`, `socialCreativeService.js` |
| Approval/audit | `SocialPostDraft`, `SocialAuditLog`, existing admin controllers |
| Scheduling/publishing | `dailyBatchScheduler.js`, `socialPublishingService.js`, `SocialPublication` |
| Instagram transport | `instagramConnectionService.js`, `instagramPublishService.js` |
| Metrics | `SocialMetricSnapshot` and existing affiliate/admin analytics |
| Admin UI | `frontend-next/src/components/admin/social` |

## Missing or incomplete functionality

1. No durable weekly-plan aggregate that contains at least eight candidates, exactly the selected feed set, week/timezone, balance assessment, rationale, evidence and approval state.
2. Existing generation is daily-draft oriented. Supervisor, weekly market research, audience intelligence and growth analyst roles need distinct prompt versions and stage records.
3. No GA4 Data API or Search Console ingestion.
4. No n8n signed trigger/notification adapter or version-controlled workflow exports.
5. Instagram connection health does not yet expose a detailed capability matrix derived from login method, scopes, account type and app configuration.
6. Meta POST webhook verification/signature handling and community-item ingestion are missing.
7. Direct publishing is mature for image/carousel but video, Reel and Story container paths and tests are incomplete.
8. Account/media insights and comment/mention/tag/message/private-reply operations are incomplete.
9. No Community Inbox with AI classification, suggested replies, approval and escalation.
10. Performance lacks combined historical Instagram + GA4 + Search Console aggregates and a versioned learning summary that informs the next week.
11. The admin currently has Today, Research, Calendar, Performance, Settings and Audit rather than the requested connections/strategy/studio/queue/published/community information architecture.

## Deterministic fallback and template audit

- Earlier generic/template content fallbacks have been removed from the Social Manager generation path. Provider or validation failures remain explicit failures.
- Current prompts and schemas do not force a default carousel; single-image is a first-class choice.
- Sharp/code composition is intentionally deterministic only for exact approved typography, disclosure, logo, cropping and export. Original artwork must come from GPT Image or an approved authentic product asset.
- Evergreen content remains permitted when current evidence is weak, but topic, copy and visual direction still come from the AI stages and the evidence weakness must be recorded.

## Components to refactor or extend

- Add a weekly orchestration service alongside, not inside, the large daily `socialManagerService.js`.
- Add focused schemas/prompts for weekly research, audience intelligence, weekly planning, analytics learning and community replies.
- Add server-side connector modules with bounded timeouts, redaction, aggregate-only payloads and dependency injection for tests.
- Extend Instagram transport for capabilities, webhooks, insights/community and video-family containers without weakening the existing publication state machine.
- Expand the frontend through additional focused views and API adapters instead of making `SocialMediaManager.tsx` a second monolith.
- Extend settings conservatively. A weekly publication maximum is a scheduling/business invariant, not a request-count throttle. Per the administrator's explicit direction, the removed Social Manager and Instagram-integration request-count/time throttles will not be reintroduced; provider backoff, idempotency, retry limits and cost ceilings remain operational safeguards.

## Security findings and controls

Existing strengths include server-only secrets, encrypted Instagram tokens, OAuth state validation, admin-gated routes, URL/source validation, audit history, idempotency and output validation.

Required additions:

- Preserve the raw webhook body and validate `X-Hub-Signature-256` before parsing/ingestion.
- Derive capabilities from granted permissions; never expose tokens or credential material in health responses.
- Validate Google service-account JSON server-side, request only read-only scopes, and send only aggregates to AI.
- Sign n8n webhook requests, use allowlisted HTTPS endpoints, and keep the database authoritative.
- Apply outbound timeouts, redirect limits, DNS/private-network/URL checks where URLs are fetched, structured redaction and bounded retries.
- Keep community sending disabled by default and require a separate approval transition.
- Treat research/webhook text as untrusted input and never allow it to change instructions, approve, publish or request secrets.
- Run dependency audit before deployment and pin any newly adopted dependency. The planned connector implementation does not require a paid service.

## Proposed implementation

1. Create `SocialWeeklyPlan`, `SocialConnectionHealth`, `SocialGrowthSnapshot` and `SocialCommunityItem` collections with indexes and immutable provenance fields.
2. Add weekly role schemas/prompts and an orchestrator that gathers verified internal truth and aggregate external signals, creates at least eight materially different candidates and selects no more than the configured weekly maximum (default 3).
3. Add a connections service for OpenAI, Instagram/Meta, GA4, Search Console, n8n and research adapters. Health checks must be explicit and safe.
4. Add Google aggregate collectors, signed n8n trigger support, official-source RSS/GDELT adapters and configurable research allowlists/watchlists.
5. Extend direct Meta support for capability discovery, signed webhooks, insights/community reads and supported media containers.
6. Add weekly plan, connection, analytics and community APIs protected by existing admin authorization.
7. Add Connections, Weekly Strategy, Research Desk, Creative Studio/Approval Queue, Published & Analytics and Community Inbox views while retaining the proven calendar/settings/audit controls.
8. Add migration, mocked tests, environment examples, n8n workflow exports and operating/security/deployment documentation.

## Required credentials and external setup

- Existing `OPENAI_API_KEY`, plus optional per-role model overrides.
- Meta App ID/secret, redirect URI, webhook verify token, API version and a connected Instagram Professional account with reviewed permissions appropriate to each enabled capability.
- GA4 property ID and a read-only Google service account granted access to that property.
- Search Console site URL and the same or separate read-only service account granted access.
- Optional self-hosted n8n webhook URL/secret. Credentials stay in n8n/Pink Paisa secret storage and are omitted from exported JSON.
- Public HTTPS media URLs reachable by Meta.

## Migration plan

1. Run the existing Social Manager foundation migration if not already applied.
2. Run the new social-growth migration to create indexes and merge non-secret weekly/connection defaults into existing admin settings.
3. Do not rewrite or delete existing drafts, prompt versions, sources, assets, publications, audit logs or metric snapshots.
4. Deploy API/model changes before enabling worker schedules or webhook subscriptions.
5. Configure and health-test connections individually; unavailable services remain disabled without blocking existing creative review.
6. Enable weekly planning, then pre-publication generation, then approved publishing, then metrics/community ingestion.
7. Keep auto-publish, auto-reply and auto-DM disabled during the initial production stage.

## External-policy notes

- Meta's official Instagram API collection documents professional-account publishing, comment management, mentions and other permission-dependent features. Capability availability differs by login method and app review, so the product must show limitations rather than infer them.
- GA4 Data API and Search Console provide aggregate reporting suitable for this workflow; Search Console queries are a topic-interest signal, not an Instagram trend feed.
- n8n workflow JSON may be version controlled, but credential values must never be exported.
- Postiz is useful architectural prior art but is AGPL-licensed and will not be copied or deployed as a second dashboard. Community nodes/templates will not be imported without an explicit dependency, licence, credential and outbound-call review.
