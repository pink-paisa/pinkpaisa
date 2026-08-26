# Pink Paisa optional n8n workflows

These are credential-free, inactive exports for optional orchestration around the first-party Social Media Manager API. They do not contain a database connection, OpenAI/Meta/Google credential, live hostname or shared-secret value.

MongoDB and the Pink Paisa services remain the source of truth. n8n only asks Pink Paisa to perform an operation with a stable idempotency key and reports execution failure. It cannot approve a plan/draft, bypass the weekly maximum, publish directly to Meta, send a community reply, or mark a provider action successful.

## Exports

| File | Trigger | First-party action |
| --- | --- | --- |
| `pink-paisa-weekly-plan-trigger.json` | Sunday 18:00 Asia/Kolkata | `POST /api/social-media-manager/orchestration/weekly-plan` |
| `pink-paisa-prepublication-trigger.json` | Hourly at :15, plus optional bearer-protected n8n Webhook | `POST /api/social-media-manager/orchestration/prepublication` with a 24-hour lookahead |
| `pink-paisa-metric-refresh-and-failure-alert.json` | Every six hours at :30, plus optional bearer-protected n8n Webhook | `POST /api/social-media-manager/orchestration/metrics`; on endpoint failure, POST a redacted alert to the configured alert receiver and keep the execution failed |

All exports have `active: false`. Importing them does not schedule work. A Schedule Trigger runs only after the workflow is reviewed and published/activated in n8n.

## Runtime values

Provide values through the n8n deployment's environment or approved external-secret integration:

```text
PINK_PAISA_BASE_URL=https://pinkpaisa.in
N8N_SOCIAL_WEBHOOK_SECRET=<independent high-entropy shared secret>
N8N_TRIGGER_BEARER_TOKEN=<independent high-entropy manual-trigger secret>
SOCIAL_ALERT_WEBHOOK_URL=https://approved-alert-receiver.example/path
```

Requirements:

- `PINK_PAISA_BASE_URL` must be HTTPS and must not end with `/` because the workflows append an absolute `/api/...` path.
- Pink Paisa must have the same `N8N_SOCIAL_WEBHOOK_SECRET` in `server/.env` and must be reloaded after it changes.
- `N8N_TRIGGER_BEARER_TOKEN` protects only the optional n8n Webhook triggers and must contain at least 32 characters. Call them with `Authorization: Bearer <value>`. A missing/short secret disables the branch. Failed checks return no first-party request; because the Webhook acknowledges on receipt, inspect the n8n execution rather than treating HTTP 202 as job success.
- `SOCIAL_ALERT_WEBHOOK_URL` is runtime secret material when it embeds a webhook token. Keep it out of JSON/source control and restrict it to an approved HTTPS destination.
- If the n8n installation blocks `$env` access in nodes, replace the expressions with the installation's external-secret/approved variable expressions. Do not commit resolved values and do not weaken a shared n8n environment without a security review.

No n8n credential IDs are referenced by the exports. The Crypto node reads the shared secret expression only at execution time.

Pink Paisa's `N8N_SOCIAL_WEBHOOK_URL` setting belongs to the separate Pink Paisa -> n8n event connector and is not needed by these inbound trigger exports. Consequently the admin Connections card for n8n, which describes that outbound connector, can remain `NOT_CONFIGURED` while these signed inbound endpoints work. Verify inbound operation through the endpoint response and resulting Mongo/admin state.

## Exact signing contract: n8n to Pink Paisa

The Set node produces one compact JSON string. The Crypto node signs a version 1 canonical envelope containing that exact string, and the HTTP Request node sends the same string as the raw `application/json` body:

```text
message = [
  "pink-paisa-social-orchestration/v1",
  "POST",
  exact_canonical_path,
  canonical_operation,
  exact_idempotency_key,
  epoch_seconds_timestamp,
  exact_raw_json_body
].join(LF)

digest = lowercase hexadecimal HMAC-SHA256(message, N8N_SOCIAL_WEBHOOK_SECRET)
header = "v1=sha256=" + digest
```

Canonical pairs are `weekly-plan` / `WEEKLY_PLAN`, `prepublication` / `PREPUBLICATION`, and `metrics` / `METRICS`, using the complete `/api/social-media-manager/orchestration/...` path shown in each export. The body is the last envelope field, so its bytes—including any newlines—are preserved exactly.

Headers:

```text
X-Pink-Paisa-Timestamp: <timestamp>
X-Pink-Paisa-Signature: v1=sha256=<digest>
X-Idempotency-Key: <operation and time bucket>
Content-Type: application/json
```

Pink Paisa captures the raw body, permits a five-minute clock window and compares the complete signature in constant time. Changing the method, path/operation, key, timestamp, or formatting/re-serialising the body after signing invalidates it. The previous unversioned inbound `sha256=<digest>` format is not accepted. Keep the n8n and Pink Paisa host clocks synchronized.

The weekly key is stable for the Sunday run date, prepublication for an IST hour and metrics for a six-hour epoch bucket. Before executing, Pink Paisa creates or claims a persisted `SocialOrchestrationReceipt` scoped to the endpoint operation and key, binds it to the exact body hash, and stores the exact terminal status/body for replay. Completed duplicates return `X-Idempotent-Replay: true`; active work returns `409` with `Retry-After`; a changed body under the same key returns `409`.

The route/operation and idempotency key are cryptographically bound by the version 1 HMAC. Pink Paisa additionally derives a delivery fingerprint from the verified timestamp, normalized signature and exact body and atomically reserves it under a globally unique Mongo index before execution. Reusing an already verified delivery across receipts returns `409`; this remains defense-in-depth rather than the primary protection. HTTPS is mandatory because signatures do not encrypt content.

Do not change the key merely to force work. Signed weekly orchestration rejects `force:true`; a reviewed, authenticated admin action is the only force-reset path.

## Manual Webhook triggers

The prepublication and metrics exports include Webhook nodes for a controlled on-demand trigger. They deliberately do not store an n8n credential reference, so the next IF node compares the `Authorization` header with the environment-backed bearer secret before building/signing a first-party request.

Additional production hardening is recommended:

- expose n8n only behind HTTPS;
- restrict the Webhook path by reverse-proxy/network policy where practical;
- keep n8n editor/project access limited;
- rotate `N8N_TRIGGER_BEARER_TOKEN` separately from the Pink Paisa HMAC secret;
- retain error executions for investigation and minimize successful execution retention;
- never pass `force: true`, arbitrary date ranges or user-supplied URLs from the manual trigger.

An unauthorised Webhook call can create a rejected n8n execution, but it cannot reach the Pink Paisa endpoint through the workflow branch.

## Failure alert scope

The metric workflow's error output creates a small alert containing workflow name, observed time, idempotency key and a bounded error message. It intentionally excludes credentials, raw provider responses, customer/community content and analytics rows. It then ends with Stop and Error so monitoring still sees a failed execution. The first-party metrics request has a bounded three-attempt retry with five seconds between tries. n8n reuses the same already-built body, timestamp, signature and key: a stored success is replayed without rerunning metrics, while a stored retryable server failure may atomically claim the next receipt attempt. An active long-running owner can still return `409`; after the bounded retry path fails, inspect Pink Paisa receipt/metric state before a deliberate new execution.

The receipt is not a distributed transaction with GA4, Search Console, Meta or OpenAI. A process crash after downstream work but before terminal receipt persistence leaves a stale lease that may later be reclaimed, so downstream snapshot/generation keys remain necessary. Treat an attempt count above one as operational evidence to reconcile, not proof that every downstream call occurred exactly once.

This alert covers a failed HTTP execution of this metric workflow. It is **not** a global Social Manager failure event stream and does not prove that every asynchronous worker/provider failure is alerted. Monitor Mongo/PM2/admin failure states separately.

If Pink Paisa is later configured to send signed outbound events to an n8n Webhook, note that the existing reverse-direction connector uses a different signature: HMAC of the raw body only, an ISO timestamp, and `X-Pink-Paisa-Event-Id`. Do not reuse this directory's inbound canonical version 1 envelope for that reverse direction.

## Activation checklist

1. Keep the built-in PM2 marketing worker running. It processes durable generation and publication queues.
2. Select exactly one owner for all three schedules. Keep `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true` and these workflows inactive for the default PM2-owned mode. Set it to `false`, reload the worker, verify the gate, and only then activate the reviewed n8n schedules. Never activate both owners.
3. Import the JSON using n8n's workflow import.
4. Verify all nodes, expressions, timezone, endpoint paths and raw body mode against the installed n8n version.
5. Supply staging environment/external-secret values.
6. Manually execute each schedule path once in staging.
7. Test the manual Webhook with correct and incorrect bearer values.
8. Independently test the legacy signature, wrong HMAC, changed method/path/key/body, stale timestamp and missing idempotency key against staging; each must fail.
9. Confirm completed response replay, body-conflict rejection, global signed-delivery replay rejection, weekly `force:true` rejection, prepublication deduplication and bounded metric retry behavior. Verify the Mongo receipt attempt/status and resulting plan/snapshot state.
10. Confirm a simulated/staging endpoint failure sends a redacted alert and leaves the n8n execution failed.
11. Set production values, import/review again, then activate only the approved workflow(s).
12. After activation, verify the resulting Pink Paisa record. n8n HTTP success is only transport success.

To pause orchestration, deactivate the workflow. To rotate the HMAC secret, deactivate all three, change both systems, reload Pink Paisa, test staging/signature failure, then reactivate.

## Validation in this repository

From PowerShell at the repository root:

```powershell
Get-ChildItem -LiteralPath deploy/n8n -Filter *.json |
  ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json | Out-Null }
```

Also verify every export remains inactive and has no credential block before committing.

## Official references

- n8n workflow export/import: https://docs.n8n.io/workflows/export-import/
- Schedule Trigger: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/
- Webhook node and test/production URLs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- HTTP Request node: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
- n8n environment access security: https://docs.n8n.io/hosting/configuration/environment-variables/security/
- n8n security audit: https://docs.n8n.io/hosting/securing/security-audit/
- n8n Crypto HMAC implementation (primary source): https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Crypto/v1/CryptoV1.node.ts
