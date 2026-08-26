# AI Social Media Manager security and threat model

> Historical version 2 foundation threat model. Use [the current version 3 security guide](pink-paisa-social-manager-security.md) for the independent weekly Social Growth Team, signed orchestration, Meta research, licensed audio, and current no-request-throttle policy.

This document describes the implemented security boundaries, controls, residual risks, and incident procedure for Pink Paisa's AI Social Media Manager. It complements the platform-wide security controls already used by the Express API, admin authentication, Instagram connection, MongoDB, Nginx, and PM2 deployment.

## Security invariants

The following invariants are intentional and must remain true:

1. Every Social Manager API route is authenticated and restricted to the `admin` role.
2. Human approval is required for the exact current draft revision and its active creative assets.
3. Publishing requires both a server environment flag and persisted `INSTAGRAM_GRAPH` settings.
4. Generation, editing, regeneration, rendering, export, and scheduling never implicitly approve content.
5. OpenAI output is strict structured data, revalidated by the server, and requested with `store: false`.
6. External research is untrusted data and cannot change brand, safety, approval, database, tool, or publishing rules.
7. Current claims require validated source traceability.
8. Only first-party public landing pages are allowed.
9. Every Instagram publish uses approved public assets, an idempotent payload fingerprint, and the intended connected account.
10. A provider success is recorded only when Instagram returns a real media ID. Uncertain outcomes are not automatically retried.
11. Audit events are append-only and metric snapshots are immutable through the application model.

Any change that weakens one of these invariants requires an explicit security and compliance review.

## Data flow and trust boundaries

```text
Admin browser
    |  signed admin session + CSRF + HTTPS
    v
Express admin API
    v
MongoDB <---- leased marketing worker/scheduler
    ^                 |          |             |
    |                 |          |             +-- Instagram Graph API
    |                 |          +-- OpenAI Responses API / web search
    |                 +-- configured trusted HTTPS RSS feeds
    |
    +-- drafts, sources, assets, prompt versions, audit,
        publications, metrics, settings

Public HTTPS /uploads/generated/campaigns/*.jpg
    ^
    +-- exact-copy programmatic renderer and Instagram fetch
```

Principal trust boundaries are:

- Browser to API: an administrator may be malicious, compromised, or tricked by CSRF/social engineering.
- API/worker to MongoDB: it holds operational, idempotency, lease, and audit state.
- API/worker to AI and research providers: content leaves Pink Paisa's infrastructure and provider output is untrusted.
- Worker to Instagram: a successful call changes external public state.
- Local asset storage to public web: generated creatives are intentionally world-readable.

## Protected assets and classification

| Asset | Sensitivity | Main controls |
| --- | --- | --- |
| Admin session/JWT and CSRF token | Critical | Secure cookie behavior, signature validation, auth-version invalidation, CSRF double-submit check, HTTPS |
| `JWT_SECRET` | Critical | Environment-only secret, restricted file permissions, rotation invalidates sessions |
| Instagram app secret and access token | Critical | Environment secret; token encrypted with AES-256-GCM in production; least-privilege scopes |
| `INSTAGRAM_TOKEN_ENCRYPTION_KEY` | Critical | Environment-only key; separate from JWT and audit salt; backed up securely |
| OpenAI API key | High | Environment-only bearer credential; not stored in Social settings or audit |
| SMTP password | High | Environment-only credential; production startup validation |
| Draft copy, plans, research, prompt templates | Internal | Admin-only API, Mongo access control, backups, bounded provider input |
| Audit records and publication checkpoints | High-integrity | Unique IDs, append-only application model, backups, restricted Mongo access |
| Metric snapshots | Internal/high-integrity | Immutable application model and unique snapshot key |
| Rendered creatives | Public | Approved content only, checksum/provenance, public HTTPS path, no secrets/PII |
| Reviewer email addresses | Personal/internal | Admin-only settings and audit-visible field changes; restrict database access |
| Source IP hash | Pseudonymous | SHA-256 with `SOCIAL_AUDIT_IP_SALT`; never store raw IP in Social audit records |

The Social Manager is designed to send aggregate/public product and content signals to AI providers, not customer records or direct identifiers. Do not add order, session, address, payment, health, or other customer-level data to provider contexts.

## Access control and request security

All routes under `/api/social-media-manager` apply `protect` and `adminOnly` before any controller:

- A signed customer/admin token is required.
- The decoded user is reloaded from MongoDB.
- Token `auth_version` must match the user, allowing global session invalidation.
- Locked accounts are rejected.
- The user role must be exactly `admin`.

Cookie-authenticated unsafe requests require a signed CSRF token in both the `pinkpaisa_csrf` cookie and `X-CSRF-Token` header. The cookie uses `SameSite=Strict` and is secure in production. Social Manager routes are not CSRF-exempt.

The existing API also applies:

- Explicit CORS origins with credentials.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- Strict referrer and permissions policies.
- HSTS on HTTPS requests.
- A 1 MB JSON/request-body limit.

The Social Manager intentionally has no request-count window, hourly/daily generation cap, or daily image-generation cap. Authentication, authorization, CSRF, schema validation, idempotency, bounded per-run retries, the monthly currency budget, and provider-side budgets/alerts remain the abuse and cost controls.

Residual risk: every administrator currently has the same Social Manager permissions. There is no separate editor, reviewer, publisher, or settings-manager role. The default settings also allow self-approval. Use separate named admin accounts and operating procedures if Pink Paisa requires separation of duties.

## Secrets management

Secrets belong in the backend environment or a managed secret store, never in:

- Social Manager settings.
- Prompts, copy, alt text, sources, or landing pages.
- Audit metadata or error notes.
- Generated image prompts or public assets.
- Frontend `NEXT_PUBLIC_*` variables.
- Git history, deployment archives, or screenshots.

Use filesystem permissions that allow only the service account to read `/home/ubuntu/pinkpaisa/server/.env`. Rotate secrets after staff changes, suspected exposure, or environment cloning.

Instagram tokens are encrypted with AES-256-GCM using a SHA-256-derived key from `INSTAGRAM_TOKEN_ENCRYPTION_KEY`. Production refuses to store, refresh, or read plaintext connection tokens. Changing the encryption key makes existing tokens unreadable; plan a reconnect during key rotation.

The OpenAI request includes the key only in the `Authorization` header. The Social audit stores provider/model names, prompt-version IDs, token counts, hashes, and errors, not the API key or complete provider response.

Avoid verbose reverse-proxy or application logging of request headers and bodies. Provider error messages are retained in run/publication state and audit; operators should not paste credentials into provider-configurable fields.

## Environment gate precedence

Persisted Social Manager settings normally overlay the environment-derived defaults. Two explicit false environment values are applied again after that merge as one-way deployment kill switches:

- `SOCIAL_MANAGER_ENABLED=false` disables the feature even when persisted `feature_enabled` is true.
- `SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false` disables daily generation even when its persisted setting is true.

Environment `true` does not force a persisted disabled setting on. Instagram publishing separately requires both the environment publishing gate and persisted `publishing.enabled=true` with provider `INSTAGRAM_GRAPH`. Automatic publishing requires both the environment and persisted auto-publish flags in addition to those master gates.

Other values, including `SOCIAL_MANAGER_WEB_SEARCH_ENABLED`, remain defaults after settings have been persisted. Setting web search false only in the environment is therefore not a reliable incident kill switch. Disable it in persisted settings, or use `SOCIAL_MANAGER_ENABLED=false` plus a process restart to stop all new Social Manager generation while settings are remediated.

## AI provider boundary

The staged OpenAI path uses seven versioned prompts:

- Market research.
- Candidate generation.
- Strategy scoring.
- Content writing.
- Compliance review.
- Visual direction.
- Final assembly.

Each request:

- Uses the Responses API.
- Sets `store: false`.
- Sends a server-created JSON context.
- Requests strict JSON Schema output.
- Rejects invalid JSON, unknown fields, wrong cardinality, invalid format copy, and other schema violations.
- Uses bounded timeouts and retries only transient status classes.
- Records prompt/model/usage metadata without private chain-of-thought.

The server then performs its own package validation, duplicate comparison, score normalization, first-party URL validation, and deterministic compliance scan. AI compliance output never replaces server policy or human approval.

Residual risk:

- `store: false` is a provider request setting, not a substitute for Pink Paisa's vendor privacy and data-processing review.
- Strict schemas constrain shape, not truth.
- A model can produce plausible but misleading content within a valid schema.
- Provider prompts and models can change behavior across versions.

Mitigation is source traceability, deterministic rejection rules, prompt version records, explicit failure states, and human review. When evidence is weak, the AI may deliberately choose an evergreen opportunity; application code never supplies evergreen topics or copy. Never add sensitive customer data to improve generation quality.

## Prompt-injection defense

Research text is treated as data, not instruction. Implemented controls include:

- System prompts explicitly state that research cannot override safety, approval, publishing, database, or tool rules.
- Untrusted text is whitespace-normalized, control characters are stripped, role-like tags are removed, and length is bounded.
- Pattern checks reject attempts to ignore prior instructions, reveal prompts/secrets, publish without approval, override policy, invoke tools, or inject role tags.
- OpenAI-reported research URLs must exactly match canonical URLs returned in web-search tool evidence.
- Unsafe or injection-suspected sources are persisted as rejected/unsafe evidence rather than used in the final recommendation.
- Published copy is scanned again for instruction-like text.

Residual risk: pattern matching cannot identify every semantic prompt-injection technique. Review source excerpts and reject content that contains operational instructions, encoded text, irrelevant directives, or unusual role/tool language even when no automated flag appears.

## SSRF and external-research controls

### OpenAI web research

The application does not directly fetch arbitrary pages returned by OpenAI web search. It validates and stores their URLs. Accepted URLs must:

- Use HTTPS.
- Contain no username or password.
- Not use localhost, loopback, link-local, common private IPv4 ranges, or common private IPv6 prefixes as a literal/hostname.
- Not match a configured blocked domain.
- Match the configured allowlist when one is present.
- Appear in OpenAI web-search tool evidence.

Because the app does not fetch these pages, DNS resolution is not performed on this path. If future code fetches stored URLs, it must add DNS resolution, redirect revalidation, response-size bounds, content-type checks, and timeouts before release.

### Trusted RSS research

The reused RSS collector performs stronger network controls because it makes direct requests:

- HTTPS only.
- Host must appear in the configured feed list.
- DNS is resolved before each request, and private results are rejected.
- Redirects are manual, revalidated, and limited to three.
- Redirect destinations must use an already approved feed host.
- Response bodies are limited to 1 MiB.
- Requests use timeouts.
- Malformed XML and feeds without items are rejected.
- Feed failures are recorded in feed health. The daily AI analysis may proceed only with the remaining validated evidence and internal/evergreen opportunities; it must not claim a missing trend or receive application-authored fallback copy.

Keep feed configuration limited to authoritative sources. Do not add URL shorteners, user-controlled feeds, internal hosts, or services that can redirect to arbitrary destinations.

## Content, compliance, and destination controls

The deterministic compliance layer blocks high-risk language including:

- Guaranteed, assured, risk-free, double-your-money, and get-rich-quick claims.
- Personalized investment instructions.
- Unsupported securities/market predictions.
- Unsupported medical treatment, cure, diagnosis, or clinical claims.
- Missing finance education disclaimers.
- Missing affiliate disclosures.
- Affiliate prices, discounts, ratings, review counts, stock, availability, and delivery claims in manual-safe mode.
- Affiliate recommendations without one exact verified Pink Paisa catalog product ID and title.
- Time-sensitive claims without sources.
- Prompt-injection-like publishable text.
- Incorrect Instagram organic UTM source/medium.

Affiliate candidates are accepted only when that exact ID/title pair matches one active internal affiliate product with compliant status, a landing page, and approved usage rights. At publish time the server reloads the same record and requires it to remain active, visible, unarchived, affiliate-enabled, compliant, backed by a nonempty affiliate URL, and rights-cleared. Its destination must exactly match `/product/<current encoded slug>`; otherwise readiness returns `affiliate_product_unverified`.

The final Instagram caption is assembled in this order: affiliate disclosure, caption, CTA, financial disclaimer, and hashtags, with duplicates removed. The complete result must be nonempty and no longer than 2,200 characters. This places affiliate disclosure first for early visibility and prevents an individually valid editor caption from overflowing after required text is added.

Recommended landing pages are resolved against `PUBLIC_APP_URL`/`FRONTEND_URL` and must have the same origin. Admin, auth API, and Instagram admin paths are rejected. URL credentials are rejected and fragments are removed.

Residual risk: regex and schema rules are not a legal, financial, medical, advertising, accessibility, or brand review. They can produce false positives and false negatives. A qualified human must review high-impact claims and every final post.

## Creative and public media security

The renderer:

- Uses controlled 1080-wide canvas sizes.
- Builds text overlays with XML escaping.
- Preserves exact approved copy and its SHA-256 checksum in asset metadata.
- Records renderer version, source provenance, usage-rights status, base-image checksum, and validation checklist.
- Writes through a temporary file and atomic rename.
- Restricts generated filenames to a safe character set and validates resolved deletion paths against the asset directory.
- Marks earlier asset groups inactive when a new group replaces them.

Publishing accepts only active, non-deleted assets with valid or manually approved validation state. Every asset URL must be public HTTPS.

The assets themselves are intentionally public. Never render or upload:

- API keys, tokens, passwords, internal URLs, or admin screenshots.
- Customer names, addresses, transactions, health data, or other PII.
- Unlicensed images or vendor assets without confirmed usage rights.
- Confidential launch plans or embargoed information.

Local disk storage is a single-instance availability risk. Preserve `server/uploads` during deployment and back it up. Public assets are not access-controlled and should be considered permanently distributable after publication.

## Approval and change control

Approval is revision-bound:

- Only `NEEDS_REVIEW` can be approved.
- An administrator identity is required.
- Compliance must pass.
- Active assets must exist and cannot be invalid or manually rejected.
- Assets requiring manual review are marked approved by the approving administrator.
- The draft records `approved_revision`, timestamp, and administrator ID.

Editing or targeted regeneration returns the draft to `DRAFT` and clears prior approval/scheduling where relevant. Format, hook, and on-post-copy changes deactivate active creative assets. Fact-check failure also clears approval and scheduling.

Residual risk: there is no enforced two-person review and no fine-grained action permission. A compromised admin can edit and approve. Protect admin accounts with unique credentials, rapid account locking/session invalidation, workstation security, and a documented reviewer roster.

## Publishing safety

Publishing is fail-closed unless all checks pass:

- Server `SOCIAL_MANAGER_PUBLISHING_ENABLED=true`.
- Persisted `publishing.enabled=true` and `provider=INSTAGRAM_GRAPH`.
- Human approval policy enabled.
- Current revision approved by an administrator.
- Draft state is eligible.
- Supported format and valid asset count.
- Server compliance and first-party landing-page validation pass.
- Every active asset passes automated and required manual checks.
- Every asset has a public HTTPS URL.
- Instagram is connected with a supported content-publish permission.
- Token is not expired.
- Connected account matches `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` when configured.
- Draft/publication has not already been published.
- No active publication lease, uncertain prior outcome, or exhausted retry limit blocks the intent.

The operator-facing readiness codes for these newer controls are `affiliate_product_unverified`, `caption_length_invalid`, `publish_in_progress`, `publish_outcome_uncertain`, and `publish_retry_limit_reached`. Queue creation can also return HTTP 409 `publication_payload_changed` or `publication_intent_conflict`; these are payload-lock conflicts, not readiness blockers, and must not be bypassed with direct record edits.

An admin publish request runs readiness, creates or reuses a payload-locked `QUEUED` publication intent, and returns HTTP 202. HTTP 202 means accepted for durable worker processing, not published by Instagram. Only the worker performs the provider call, and only final `PUBLISHED` state with a real media ID is success.

Before the provider call, the service persists a unique publication record containing:

- Draft and approved revision.
- Caption hash.
- Asset fingerprint.
- Full payload fingerprint.
- Readiness snapshot.
- Idempotency key.
- Provider checkpoints.

The existing Instagram adapter reports container creation and publishing checkpoints. `publishing.retry_limit` counts retries after the first attempt, so the default value of three creates `max_attempts=4`. Retriable failures use bounded exponential backoff. Exhaustion blocks the intent with `publish_retry_limit_reached`. If Instagram may have accepted the request, publication becomes `UNCERTAIN` and automatic retry stops.

Scheduling a draft is explicit publish intent. The scheduler processes due approved schedules when the master publishing gate is enabled; it does not use `auto_publish` as an additional due-schedule gate. The `auto_publish` preference cannot approve a draft and currently does not auto-schedule generated content.

Residual risk:

- Meta may accept a request before the network response is lost.
- A compromised Instagram connection can publish to the wrong external state if account pinning is omitted.
- Public asset URLs can be cached independently of Pink Paisa.
- Human approval can still approve incorrect content.

Use account pinning, controlled initial publishes, manual reconciliation of uncertainty, and evidence preservation.

## Idempotency, retries, and concurrency

Generation runs have a unique idempotency key, availability time, attempt counter, lease owner, 15-minute lease expiry, and retry timestamp. The worker atomically claims a pending run and requeues expired leases.

Drafts have unique idempotency keys and optimistic concurrency. Publication is unique per draft and rejects a payload that no longer matches its existing fingerprint. Metric snapshots accept a client idempotency key and otherwise derive one from draft, capture time, and metrics.

Publication workers atomically claim eligible records with a lease owner, lease expiry, heartbeat, and incremented attempt count. `SOCIAL_MANAGER_PUBLICATION_LEASE_MS` defaults to 300,000 ms and has a 60-second minimum; provider progress checkpoints refresh the heartbeat and lease.

- An expired `VALIDATING` or `CONTAINER_CREATED` lease has not crossed the media-publish checkpoint. The worker safely marks it `FAILED` with an immediate retry and resumes from stored container state.
- An expired `PUBLISHING` lease crossed the pre-media-publish checkpoint. The worker changes it to `UNCERTAIN`, clears automatic retry, and requires manual Instagram reconciliation.
- If a real media ID was checkpointed in a `PUBLISHED` publication before the linked draft save completed, the next worker pass reconciles the draft to `PUBLISHED` without another provider call.

The daily scheduler has in-process single-flight protection plus a heartbeated Mongo lease to avoid multiple process owners scheduling the same work. Production should still run one designated scheduler process.

Residual risk: MongoDB superusers can bypass Mongoose immutability and unique-index controls. Restrict database credentials, alert on direct production writes, and back up before migrations.

## Audit, privacy, and retention

Social audit events record:

- Entity and linked run/draft/publication IDs.
- Action and outcome.
- Actor type and administrator ID when present.
- Summary and bounded field changes.
- Request ID.
- Salted source-IP hash.
- Prompt/source/model references and retry count.
- Sanitized operational errors and metadata.

Audit records are append-only through Mongoose middleware. Metric snapshots are immutable through the same application layer. Prompt versions are immutable for their defining fields and are activated by version.

Important limitations:

- A Mongo administrator can modify records outside the application.
- Audit field changes can contain post copy, settings text, and reviewer email addresses. They must not contain secrets.
- The admin draft detail endpoint returns the newest 100 audit events, not the complete collection.
- There is no automated retention, legal hold, export, or purge policy specifically for Social Manager data.

Define a Pink Paisa retention policy for drafts, research excerpts, metrics, audit, publication evidence, logs, and backups. Deletion must account for legal/compliance and incident-investigation needs. Do not silently mutate immutable records to correct history; append a new event or snapshot.

## Threat register

| Threat | Implemented controls | Residual risk and response |
| --- | --- | --- |
| Anonymous or customer-role API access | JWT/session validation and global `adminOnly` middleware | Admin account compromise remains; lock account and increment auth version |
| CSRF or clickjacking | Signed double-submit CSRF, SameSite Strict, frame denial, explicit CORS | Admin social engineering remains; require confirmation and staff training |
| API abuse/cost exhaustion | Admin-only authentication, CSRF, idempotency, bounded workflow retries, and a monthly threshold based on server-estimated token and image cost | There is intentionally no count/time request or daily generation/image cap. A compromised admin can consume budget quickly; estimates use `SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION`, `SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION`, and `SOCIAL_MANAGER_INR_PER_USD`, so provider budgets/alerts remain authoritative when rates are zero or stale |
| Prompt injection from research | Untrusted-data prompts, sanitization, pattern rejection, tool-evidence URL matching, strict schema | Novel semantic injection; manually inspect excerpts and narrow allowlist |
| SSRF through feeds | HTTPS, explicit hosts, DNS private-IP rejection, redirect revalidation, size/time limits | Compromised approved host; keep feed list authoritative and monitor changes |
| Hallucinated/current false claim | Source requirement, source persistence, fact check, strict schema, deterministic compliance, human approval | Source itself may be wrong or stale; expert review remains required |
| Unsafe finance/health/affiliate content | Block patterns, disclosures, landing restrictions, exact affiliate-product revalidation, complete-caption limit, compliance penalty/rejection | Rules are not exhaustive; legal/compliance review for high-impact posts |
| Duplicate or repeated content | 90-day similarity check, promotion rotation, idempotent generation/publication | Semantic near-duplicates can evade token similarity; editorial review required |
| Wrong or stale creative | Exact-copy checksum, versioned asset groups, creative invalidation, manual asset approval | Certain visual-brief edits may require deliberate rerender; inspect final asset every time |
| Wrong Instagram account | Connected-account summary, required scope, token expiry, optional account ID pin | Omitted/misconfigured pin; require controlled publish and verify permalink |
| Duplicate external publish | One publication per draft, payload fingerprints, atomic leases, resumable pre-publish checkpoints, bounded retry, uncertain stop | Provider ambiguity after the media-publish checkpoint cannot be eliminated; reconcile manually |
| Secret exposure | Backend env, encrypted Instagram tokens, no secret fields in provider context/audit | Server/log/backup compromise; restrict access and rotate promptly |
| Audit tampering | Append-only model and backups | Database administrators can bypass application; least privilege and external backup monitoring |
| Public-media disclosure | Controlled directory and approved asset pipeline | Anything rendered is public; prohibit PII/secrets and remove unsafe assets before publish |

## Security verification checklist

Before every production enablement:

- [ ] `npm test` passes, including Social Manager core/provider/route tests.
- [ ] Frontend lint and TypeScript checks pass.
- [ ] MongoDB requires authenticated/private-network access.
- [ ] `.env` is not in Git and is readable only by the service account.
- [ ] `SOCIAL_AUDIT_IP_SALT`, `JWT_SECRET`, and `INSTAGRAM_TOKEN_ENCRYPTION_KEY` are separate strong values.
- [ ] Production uses HTTPS and HSTS through Nginx.
- [ ] CORS origins contain only intended Pink Paisa origins.
- [ ] OpenAI model/provider and data-processing use are approved.
- [ ] OpenAI input/output token-rate environment values match the deployed models, and provider-side budgets/alerts are enabled.
- [ ] Research allowlist and feed list contain only reviewed domains.
- [ ] Reviewer email list contains current authorized staff.
- [ ] Human approval remains true.
- [ ] Publishing and auto-publish remain false until the controlled activation runbook is complete.
- [ ] Instagram connection shows encryption, expected username/account ID, required scope, and valid expiry.
- [ ] Generated assets open over public HTTPS and contain no PII/secrets.
- [ ] A controlled draft passes per-draft publishing readiness with no blockers.
- [ ] The controlled Publish action returns HTTP 202, then the worker reaches `PUBLISHED` with a real media ID/permalink; queue acceptance is not treated as provider success.
- [ ] Backups include MongoDB and `server/uploads` and have been restore-tested.
- [ ] Incident owners know how to stop the worker and disable both publishing gates.

## Incident response

### Suspected unsafe or unauthorized publication

1. Set `SOCIAL_MANAGER_PUBLISHING_ENABLED=false` and `SOCIAL_MANAGER_AUTO_PUBLISH=false`.
2. Restart/reload the API and marketing worker so the environment gate takes effect.
3. Disable persisted publishing settings or stop `pinkpaisa-marketing-worker` if immediate containment is required.
4. Check the actual Instagram account before retrying any failed or uncertain publication.
5. Preserve MongoDB, application logs, publication checkpoints, request IDs, media IDs, and audit records.
6. Revoke/reconnect Instagram access if the account or token may be compromised.
7. Lock compromised admin accounts and invalidate sessions through the existing auth-version mechanism.
8. Rotate affected JWT, Instagram, OpenAI, SMTP, webhook, Redis, and database credentials as appropriate.
9. Remove or correct public content according to Pink Paisa's incident policy without deleting internal evidence.
10. Before re-enabling publishing, review all due `SCHEDULED` drafts, `QUEUED` intents, and retriable `FAILED` publications, and manually reconcile every `UNCERTAIN` record; durable work can resume when the gate is restored.

### Suspected AI/research compromise

1. For an immediate hard stop, set `SOCIAL_MANAGER_ENABLED=false` and restart the API and worker.
2. Disable research/web search in persisted settings or narrow the allowlist to reviewed primary domains. Also set `SOCIAL_MANAGER_WEB_SEARCH_ENABLED=false` as the future environment default; it does not override an already-persisted true value.
3. Revoke the OpenAI key if exposed.
4. Reject affected drafts; do not merely edit out the visible suspicious phrase.
5. Preserve sources, rejected flags, prompt versions, runs, and audits.
6. Review provider inputs and outputs for unexpected sensitive data.
7. Restore the feature gate only after settings are safe, then resume with evergreen/trusted-feed mode until the incident is understood.

### Suspected secret exposure

Rotate the exposed secret first, then update services and reconnect external accounts. For `INSTAGRAM_TOKEN_ENCRYPTION_KEY`, existing ciphertext cannot be read under a new key, so explicitly reconnect Instagram. For `JWT_SECRET`, expect existing sessions and CSRF tokens to become invalid.

## Known limitations and required operator controls

- The application has one broad admin role; use organizational separation of duties where needed.
- The compliance engine is deterministic but not exhaustive and is not professional advice.
- Prompt-injection pattern checks cannot catch every attack.
- Web-search evidence proves tool provenance, not source truth.
- OpenAI and Meta remain external processors with their own security and availability characteristics.
- OpenAI token cost is estimated from configurable per-million-token rates. Zero or stale rates make the persisted monthly threshold incomplete, so provider-side budgets remain authoritative.
- There is no count/time-based request throttle, hourly/daily generation cap, or daily image cap; monitor the monthly budget and provider alerts closely, especially for compromised-admin scenarios.
- Social Manager reviewer email is best-effort; publication safety must never depend on email.
- Stored failure/publish notification preferences are not yet wired to dedicated emails.
- Assets use local instance storage and public URLs; backups and disciplined content review are mandatory.
- There is no automated Social Manager retention or deletion workflow.
- There is no Instagram dry-run. Use readiness checks and a controlled real post.
- Scheduled publishing is gated by approval plus the master publishing switch, not by the `auto_publish` preference.

Treat these limitations as operational requirements until the implementation changes and this threat model is reviewed again.
