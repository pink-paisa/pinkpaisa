# Pink Paisa Social Media Manager security

This is the production threat model and operating baseline for the Social Media Manager. It complements the application-wide authentication, backup and incident controls; it does not replace them.

## Assets and trust boundaries

Protect:

- administrator sessions and approval identity;
- OpenAI, Meta, Google, SMTP and n8n credentials;
- encrypted Instagram access tokens and the independent encryption key;
- verified product facts, source provenance, prompt versions and compliance decisions;
- generated media, draft revisions, schedules and publication intents;
- provider media IDs, idempotency keys, metric snapshots and audit evidence;
- community text and identifiers, which may contain personal or sensitive material.

Trust boundaries are the administrator browser, Nginx/HTTPS edge, Express API, MongoDB, local media storage, PM2 worker, AI providers, Meta, Google, configured research sources and optional n8n instance. No provider response, webhook payload, external article, comment or AI output is trusted merely because it is syntactically valid.

## Authentication and authorization

- Browser admin routes under `/api/social-media-manager/admin` require the existing verified session and `adminOnly` role check.
- Cookie-backed unsafe requests use the application's signed double-submit CSRF token. Same-origin/CORS policy is not a replacement for CSRF protection.
- Admin lifecycle actions record the actor and revision. There is currently no fine-grained Social Manager role or enforced two-person approval, so administrator-account security is a material residual risk.
- Use individual administrator accounts, unique passwords, lockout/session invalidation, prompt offboarding and protected workstations. Never share a production admin session.
- n8n orchestration routes use service HMAC authentication, not browser cookies or a copied admin bearer token.

Per the administrator directive, **there is no Social Media Manager or Instagram-integration request-count throttle**. Do not mount a Social Manager/Instagram-specific limiter or restore the message `Too many Social Media Manager requests. Please wait a bit and try again.` This decision does not remove authentication, CSRF/HMAC, payload bounds, idempotency, leases, retry caps, provider quotas, cost ceilings or the weekly business maximum. Separate perimeter controls for unrelated authentication, generic uploads, payment and affiliate tracking remain outside this directive; generic edge/WAF protections must not masquerade as the removed Social Manager/Instagram limiter.

## Secrets and encryption

Production secrets belong in the host/n8n secret mechanism, never source control, frontend variables, workflow exports, Mongo settings, logs or generated assets.

| Secret | Handling |
| --- | --- |
| `OPENAI_API_KEY` | Server/worker only; provider project should have its own budget and access restriction |
| `INSTAGRAM_APP_SECRET` | Server only; also verifies Meta webhook raw-body signatures |
| Instagram access token | Created by OAuth and stored encrypted; never manually entered into the UI |
| `INSTAGRAM_TOKEN_ENCRYPTION_KEY` | Unique high-entropy key; AES-256-GCM key material; rotate only with a migration/reconnect plan |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Separate random value used only for Meta's GET challenge |
| Google service-account private key | Prefer a root-owned file outside the repo referenced by `GOOGLE_APPLICATION_CREDENTIALS`; mode 0600 and readable by the API/worker service account only |
| `N8N_SOCIAL_WEBHOOK_SECRET` | Same high-entropy value on Pink Paisa and n8n; independent from JWT, Meta, webhook-verify and encryption keys |
| `SOCIAL_AUDIT_IP_SALT` | Independent high-entropy key for HMAC-SHA-256 audit source-IP hashes; audio rights mutations fail closed without it in production |

Use `GOOGLE_SERVICE_ACCOUNT_JSON` only when the deployment secret system cannot mount a file. Inline JSON is easier to expose in process/environment diagnostics. Pink Paisa validates bounded service-account JSON, an official Google token URI and RSA key material, mints short-lived scoped tokens and redacts private material from connector errors. Still restrict filesystem permissions and rotate/delete unused Google keys.

Never rotate `INSTAGRAM_TOKEN_ENCRYPTION_KEY` by simply replacing the environment value: existing ciphertext will no longer decrypt. Disable publishing, migrate/reconnect, verify, then retire the old key.

## Signed inbound n8n orchestration

The optional n8n exports call:

```text
POST /api/social-media-manager/orchestration/weekly-plan
POST /api/social-media-manager/orchestration/prepublication
POST /api/social-media-manager/orchestration/metrics
```

For each exact UTF-8 JSON body, construct this version 1 LF-delimited byte envelope. The final field is the exact raw body, not parsed/reformatted JSON:

```text
pink-paisa-social-orchestration/v1
POST
<exact canonical path>
<WEEKLY_PLAN | PREPUBLICATION | METRICS>
<exact X-Idempotency-Key value>
<Unix epoch-seconds timestamp>
<exact raw JSON body bytes>
```

`signature = "v1=sha256=" + lowercase_hex(HMAC-SHA256(N8N_SOCIAL_WEBHOOK_SECRET, canonical_envelope))`.

The request must include:

```text
Content-Type: application/json
X-Pink-Paisa-Timestamp: <timestamp>
X-Pink-Paisa-Signature: v1=sha256=<digest>
X-Idempotency-Key: <bounded operation/time-bucket key>
```

The canonical path/operation pairs are exactly `/api/social-media-manager/orchestration/weekly-plan` + `WEEKLY_PLAN`, `/api/social-media-manager/orchestration/prepublication` + `PREPUBLICATION`, and `/api/social-media-manager/orchestration/metrics` + `METRICS`. Query strings and path aliases are rejected. The server captures the raw body before JSON parsing, derives the operation from the allowlisted request target, uses timing-safe comparison, permits only a five-minute timestamp window, and rejects a missing, overlong or control-character idempotency key. Any method, route, operation, key, timestamp, whitespace or body mutation fails authentication. The unversioned legacy inbound envelope fails closed.

After successful HMAC verification and before operation execution, Pink Paisa additionally derives `SHA-256(timestamp || LF || normalized_signature || LF || exact_body)` and atomically associates that fingerprint with an endpoint-scoped receipt. A globally unique Mongo multikey index prevents reuse of an already verified delivery across receipts. This is defense-in-depth behind the primary cryptographic binding. HTTPS is still mandatory; HMAC does not conceal content.

The receipt binds `{ operation, idempotency key }` to the exact body hash and stores the exact terminal HTTP status/body. Semantics are:

- first owner creates `PROCESSING`, holds a renewable lease, and is the only caller that executes;
- completed success and deterministic non-retryable failure replay their stored response;
- same endpoint/key with a different body returns `409 social_orchestration_idempotency_conflict`;
- the same signed delivery under a different key/route returns `409 social_orchestration_delivery_replay`;
- an active duplicate returns `409 social_orchestration_idempotency_in_progress` and `Retry-After`;
- a retryable server failure or expired lease can be atomically reclaimed with an incremented attempt count.

The response exposes `X-Idempotent-Replay` and `X-Idempotency-Attempt` for diagnosis. Receipts have no TTL in this release because deleting them would reopen replay keys. Keep them in backup/retention planning and investigate growth. These state transitions, leases and attempt evidence are not a request-count throttle. Signed weekly orchestration also rejects `force:true`; only the authenticated admin route may deliberately reset a plan.

This is not a distributed transaction across Mongo and every external provider. If a process dies after a downstream write/provider call but before it persists the terminal receipt, stale-lease recovery can execute again. Downstream plan, generation and snapshot idempotency keys remain mandatory; investigate any receipt with multiple attempts alongside provider/audit state. Publication keeps its stricter uncertain-outcome reconciliation and is not performed by these orchestration endpoints.

Idempotency is a duplicate-effect control, not caller authentication. Use stable operation/week/hour buckets, never randomize a key just to bypass an in-progress or existing record.

### Do not confuse the reverse webhook signature

The existing optional Pink Paisa -> n8n event connector uses a different envelope and signs **only the exact raw JSON body**:

```text
X-Pink-Paisa-Signature = sha256=<hex HMAC-SHA256(secret, raw_json_body)>
X-Pink-Paisa-Timestamp = ISO-8601 event timestamp
X-Pink-Paisa-Event-Id  = durable event/idempotency ID
```

Do not apply the inbound canonical version 1 envelope to that reverse direction. Any n8n Webhook receiver must retain raw body, verify its separate HMAC contract, enforce freshness and deduplicate event ID before acting. At present, a configured reverse webhook connector is not proof that every application failure emits an event; verify the producing call path during rollout.

The Pink Paisa outbound connector additionally requires HTTPS, rejects URL credentials/query/fragment, supports a host allowlist, blocks private/unsafe network targets unless explicitly opted in, limits payload size, uses bounded timeouts and disables redirects.

## Meta OAuth and webhook controls

- OAuth starts from an authenticated administrator action.
- State is a short-lived signed token backed by a one-use Mongo nonce/state record; callback replay fails.
- The production callback URI must match Meta exactly and use HTTPS.
- The current implemented connection is Instagram Login. Do not persist an ad-hoc Facebook Page token to simulate Facebook Login support.
- POST `/api/instagram/webhook` requires `X-Hub-Signature-256` over the captured raw body using the Meta/Instagram app secret. Invalid/missing signatures fail before community ingestion.
- GET verification uses an independent verify token and constant-time comparison.
- Derive availability from actual login family, professional account type and granted permissions. Never return access tokens, app secrets or Google private keys in Connections health responses.
- Pin the expected Instagram professional account with `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` where possible.

Review the current Meta setup runbook before changing permissions. Capability discovery must fail closed: App Review, account/catalog eligibility and provider response override a desired UI setting.

## Google analytics data controls

- Enable only the GA4 Data API and Search Console API operations required for aggregate reporting.
- Grant the service-account email Viewer access to the exact GA4 property and read access to the exact Search Console property.
- Use the read-only scopes `analytics.readonly` and `webmasters.readonly`; do not grant write/admin roles for this workflow.
- `GA4_PROPERTY_ID` is the numeric property ID. `GOOGLE_SEARCH_CONSOLE_SITE` is the exact verified `sc-domain:...` or URL-prefix property.
- Collect only allowlisted aggregate dimensions/metrics with bounded rows/date ranges. Do not send raw customer/order/vendor identities, IPs, account-level messages or Google credentials to the AI.
- Google/Instagram missing data, thresholding and attribution gaps must be represented as partial/unavailable, not fabricated zeros.

Official Google guidance:

- GA4 Data API quickstart: https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
- GA4 access roles: https://support.google.com/analytics/answer/9305587
- Search Console API authorization: https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- Search Console users/permissions: https://support.google.com/webmasters/answer/7687615
- Service-account security: https://cloud.google.com/iam/docs/best-practices-service-accounts
- Key creation/deletion: https://cloud.google.com/iam/docs/keys-create-delete

## AI, research and product integrity

- External research, comments and webhook text are data, never instructions. Sanitize/control characters, bound length, retain source, and block prompt text that attempts to change policy, approve, publish, request secrets or call arbitrary tools.
- Meta hashtag and Business Discovery captions are transient untrusted input. Persist only controlled topic/structure counts, bounded public indicators and source permalinks; never store or reproduce source captions or creative media. Enforce Meta's rolling unique-hashtag allowance before a new query and do not replace missing discovery permission with browser scraping.
- Use structured schemas and server-side validation at every AI role boundary. Do not extract or display hidden chain-of-thought.
- Keep model response IDs, fingerprints, attempts, timing and token/image usage for provenance; redact prompt secrets and sensitive source content.
- The compliance model is independent from the copy stage. Bounded AI revision either reaches `PASS` or leaves a visible failure.
- No deterministic content fallback and no template-only completed creative are allowed after provider/schema/image failure.
- Product claims must be grounded in the current verified catalog record. Revalidate active/visible/affiliate/compliance/link state at publish time.
- Product creative generation reloads the exact active product from MongoDB and compares its id, title and authoritative image URL before any provider call. OpenAI generates only a text-free, product-free setting and never receives product pixels through an image-edit endpoint. Guarded Sharp code stores the exact source bytes, places that reference once without cropping or generative retouching, and then applies the approved copy/logo overlay.
- Remote product media is HTTPS-only and restricted to the explicit `SOCIAL_PRODUCT_IMAGE_ALLOWED_HOSTS`/Pink Paisa/Amazon image allowlist. Redirects, credentials, nonstandard ports, compressed bodies, private/reserved DNS results, unsupported MIME/file signatures, excessive bytes/pixels and checksum mismatches fail closed. This fetch is only for the image URL already attached to the verified database product; it is not web scraping.
- Do not provide personalised medical, legal or financial advice. Escalate community items involving harm, diagnosis, disputes, threats, PII or uncertain regulation.

## Asset and publishing controls

- Generated media is public by design once exposed under `/uploads`; never place secrets, admin screens, customer data or confidential plans in an asset.
- Licensed audio originals are different: store them only under `SOCIAL_AUDIO_LIBRARY_ROOT` outside `/uploads`, never expose the storage key/path, and preview them only through the authenticated admin stream with `private, no-store` and `nosniff` headers.
- Accept only bounded MP3/M4A/WAV/OGG uploads whose extension, MIME, magic bytes, decoded audio-only stream, codec, duration and checksum agree. Record the administrator, source, licence reference and confirmation statement; never scrape audio.
- A selected audio track must still be active and rights-confirmed at assembly and publication. The final MP4 provenance checksum must match the selected record. Revocation invalidates affected videos/approvals and opens a manual action.
- Preserve the complete active asset lineage. Exact-overlay creatives require the original AI image plus separately composed final; native-v2 creatives require the byte-preserving provider original plus resize/encode-only normalized original and checksum-identical no-overlay passthrough final. Record source/model/prompt-run provenance and hashes.
- Product assets additionally retain the AI-background URL/checksum, exact stored product-reference URL/checksum/signature, database verification evidence and local-composition recipe. Packaging, label, colour, variant and quantity remain mandatory human-review items; missing or mismatched proof blocks readiness and publication.
- Require supported MIME/dimensions/count, active revision, rights status, validation result and public HTTPS URL.
- Approval is revision-bound. Copy, format, strategy or asset replacement invalidates stale approval as applicable.
- Publication uses a payload fingerprint and durable idempotent intent. HTTP 202 is acceptance only.
- Retry only before a provider-side uncertain checkpoint. `UNCERTAIN` stops automation and requires Instagram reconciliation.
- The weekly feed maximum (default three, bounded by server policy) is enforced independently of orchestration frequency. It is a business invariant, not request throttling.

## Community privacy and safety

- Keep automated sending disabled by default. AI recommendation, human approval and provider send are distinct transitions.
- Retain only fields needed for moderation/reply/audit and follow the organisation's documented retention/deletion policy.
- Never send private community text or user identifiers to general research prompts or growth summaries. Use aggregate themes.
- Unsupported comment/message/private-reply operations create a manual action. They are not marked successful.
- A high-risk or sensitive item goes to a human support/escalation channel; do not ask for account/payment/health details in a public reply.

## Logging, monitoring and retention

- Logs should include request ID, entity/run/publication ID, stage/status and redacted error—not tokens, raw credentials or full sensitive messages.
- Audit logs preserve administrator actions and hashed source context without model chain-of-thought.
- Monitor PM2 API and worker separately, Mongo health, scheduler lease/heartbeat, failed generation/publication states, token expiry, connection health, n8n failures and provider budgets.
- Back up MongoDB, `server/uploads`, and the private `SOCIAL_AUDIO_LIBRARY_ROOT` together. Protect backups as production data and regularly test a metadata-plus-file restore.
- n8n exported JSON and execution history can contain request/response bodies. Exports in this repo contain only expressions/placeholders; production n8n retention and editor access must be restricted.

## Incident playbooks

### Suspected Meta/token compromise

1. Disable environment and persisted publishing gates; reload API/worker.
2. Revoke the Meta token/app access and disconnect the Pink Paisa connection.
3. Rotate the app secret and webhook verification token as applicable; update Meta and Pink Paisa atomically.
4. Review publications, community sends, webhooks and audit logs for the exposure interval.
5. Reconnect the intended account and perform a controlled readiness/publish test.

### Suspected n8n secret compromise

1. Deactivate all imported workflows.
2. Rotate `N8N_SOCIAL_WEBHOOK_SECRET` on both systems and reload Pink Paisa.
3. Review orchestration request IDs, idempotency keys, weekly plans and metric refreshes.
4. Re-test signature failure, freshness and deployed duplicate-effect behavior before reactivation.

### Wrong, duplicate or uncertain Instagram publication

1. Disable publishing; do not retry.
2. Preserve the `SocialPublication`, draft revision, assets, worker logs and provider IDs.
3. Inspect the intended Instagram account directly and reconcile the external media state.
4. Remove/correct externally only through an authorised manual decision; record it in the audit trail.
5. Fix account pinning/readiness/idempotency cause before reopening the gate.

### Fabricated or unsafe content

1. Reject/unpublish or correct the content through approved channels as urgency requires.
2. Preserve sources, verified facts, prompt/model versions, compliance result and reviewer action.
3. Disable affected automation/model/source rather than suppressing the failure.
4. Patch validation/compliance tests, then regenerate and require new human approval.

## Primary security references

- OWASP webhook security guidance: https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Guidelines.html
- OWASP SSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- Express production security: https://expressjs.com/en/advanced/best-practice-security.html
- MongoDB unique indexes: https://www.mongodb.com/docs/manual/core/index-unique/
- MongoDB unique multikey indexes: https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/
- Meta official Instagram API collection: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- n8n environment-variable access security: https://docs.n8n.io/hosting/configuration/environment-variables/security/
- n8n security audit: https://docs.n8n.io/hosting/securing/security-audit/
