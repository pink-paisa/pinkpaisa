# AI Social Media Manager admin guide

> Historical version 2 daily-workflow guide. Use [the current version 3 administrator guide](pink-paisa-social-manager-admin-guide.md) for Weekly Strategy, Research Desk, manual actions, licensed audio, analytics attribution, community work, and the three-feed-post weekly operating model.

The Social Media Manager is Pink Paisa's daily content operations workspace. It produces a reviewable Instagram package from live first-party content, recent social history, optional current research, compliance rules, and performance signals. It is not a general chatbot, and it never publishes an unapproved draft.

Open it from:

`Admin > Growth & Reporting > Social Media Manager`

Every Social Manager API route requires an authenticated user with the `admin` role. If the section does not load, first confirm the administrator session, `/api/health`, and the server/worker status.

## What one daily result contains

A complete daily package contains:

- One primary recommendation.
- Exactly two alternative recommendations.
- At least two rejected ideas with concise rejection reasons.
- An objective, format, content pillar, target segment, and short `whyToday` rationale.
- Three hooks.
- Format-specific on-post copy, such as carousel slides or a single-image headline.
- Caption, CTA, five to ten hashtags, alt text, disclosures, a first-party landing page, and Instagram organic UTMs.
- For affiliate recommendations, the exact verified Pink Paisa catalog product ID and title.
- A visual concept and text-free image-generation brief.
- Source references for any current claim.
- Confidence, risk flags, and a score breakdown.
- Programmatically rendered creative assets and validation results.

The `whyToday` field is a concise operational rationale, not hidden model reasoning. The system does not store chain-of-thought.

The original generated package remains in `result_json`. Editorial changes are made against `current_package`, so the generated baseline and the current working version remain distinguishable.

## Workspace tabs

| Tab | Use |
| --- | --- |
| Today | Generate, edit, render, review, approve, schedule, publish, export, or duplicate the selected draft |
| Research | Inspect validated sources, confidence/freshness, unsafe-source flags, and rejected candidate ideas |
| Calendar | Open recent and future drafts and filter by lifecycle status |
| Performance | Add immutable manual metric snapshots and inspect snapshot history |
| Settings | Configure brand policy, audience, content mix, times, models, budget limits, disclosures, UTMs, reviewers, and research domains |
| Audit | Inspect generation, editing, review, approval, scheduling, publication, metric, and error events for the selected draft |

The Calendar API supports pagination and a maximum of 100 drafts per page. The current admin view shows the newest returned page for its date window.

## Recommended daily workflow

### 1. Generate or open today's draft

Choose **Generate today** when no draft exists. The API queues a generation run and normally returns HTTP 202; the admin polls every two seconds for up to about 90 seconds. If the run continues in the worker, the panel can be refreshed later.

Without **force**, the server reuses today's latest draft or active run. Generating while a draft is already selected asks for confirmation and creates a fresh revision lineage for the Asia/Kolkata date. The saved earlier draft remains in the database and audit history.

Generation is bounded by:

- The configured monthly AI threshold when runs contain `usage.estimated_cost`.
- Per-run content and image retry caps.
- Idempotency keys on runs and drafts.

There is no request-count window, hourly/daily generation cap, or daily image-generation cap. Authentication, CSRF, idempotency, bounded retries, and the monthly currency budget still apply. Do not repeatedly force generation to work around an error; inspect the current run and worker logs first.

The server records token counts and estimates their cost from the configured per-million-token environment rates. If those rates remain at their zero default, the in-app monthly threshold cannot act as a monetary cap. Continue to use OpenAI/provider billing budgets and alerts.

### 2. Review the decision before editing copy

Check:

- Does the topic serve Pink Paisa's women-first wealth and wellness audience?
- Is the content pillar appropriate relative to recent posts?
- Does the score make sense across brand relevance, usefulness, timeliness, originality, engagement, business alignment, evidence quality, and compliance penalty?
- Is the `whyToday` rationale evidence-led without overstating urgency?
- Are duplicate similarity and promotion-rotation signals acceptable?
- Is the selected format practical for the available creative?
- Is the landing destination public, useful, and first-party?
- For an affiliate recommendation, do the displayed catalog ID/title and `/product/<slug>` destination match the intended product, with no invented price, rating, availability, delivery, or outcome claim?
- Does the complete Instagram caption fit within 2,200 characters after assembling affiliate disclosure first, caption, CTA, financial disclaimer, and hashtags?

Compare the two alternatives. **Use this alternative** loads an alternative into the primary editor; it is not saved until **Save draft** is pressed. Recheck its sources, destination, disclosures, score, and creative needs after adopting it.

The Research tab distinguishes sources used in the final package from research that was collected but not selected. An evergreen recommendation can have no external source. A current statistic, rule, price, event, or timely claim cannot.

### 3. Edit and save

The editor exposes strategy, hooks, format-specific copy, caption, CTA, hashtags, disclosures, destination, UTMs, visual direction, image prompt, alt text, and a future posting time.

**Save draft** sends the complete primary recommendation to the server. The server then:

1. Validates the strict package schema and format-specific requirements.
2. Runs deterministic finance, wellness, affiliate, source, destination, UTM, and prompt-injection checks.
3. Rejects invalid changes with an error and compliance details.
4. Records field-level before/after changes in the audit log.
5. Returns the draft to `DRAFT` status.
6. Clears prior approval and scheduling when the previous state was approved, scheduled, rejected, or failed.

Changing the format, hooks, or on-post copy invalidates active creative assets and marks creative readiness `STALE`. Re-render after any visual-impacting change. Caption-only changes do not alter the rendered on-post asset, but still require a new saved and approved revision.

The UI warns before navigating away with unsaved changes. Lifecycle actions are disabled until edits are saved.

### 4. Use targeted regeneration when helpful

| Action | Behavior | OpenAI required? | Creative effect |
| --- | --- | --- | --- |
| Strategy | Re-runs context, research, market analysis, candidates, selection, copy, compliance, and visual briefs without generating an image | Yes | All prior creative is stale |
| Alternatives | Re-runs the AI decision pipeline and replaces both alternatives/rejected ideas | Yes; there is no deterministic fallback | Primary creative is retained |
| Copy | Rewrites the complete format-specific copy, preserves the approved visual direction, and runs the independent compliance/revision loop | Yes | Only final composed assets become stale when on-post copy changes; original AI artwork is retained |
| Hooks | Rewrites the three hooks while preserving facts, destination, disclosure, objective, and visual direction | Yes | Final composed assets become stale only when rendered copy changes |
| Caption | Rewrites caption, CTA, hashtags, alt text, and disclosures, then runs independent AI and server compliance | Yes | On-post creative is retained |
| Change format with AI | Rewrites the complete copy and visual brief in the selected format's schema | Yes | All prior creative is stale; generate a new original visual |
| Revise with instructions | Uses the administrator direction in a format-specific AI copy call, then runs compliance/revision | Yes | Final assets become stale only if exact on-post copy changes |
| Run compliance again | Independently reviews the existing exact package and invokes up to three bounded AI revisions when required | Yes | Final assets become stale only if compliance changes on-post copy |
| Visual direction | Rewrites the format-specific visual brief and image prompt | Yes | All prior creative is stale |
| Regenerate image | Calls the configured OpenAI Image API without rewriting strategy or copy, stores the new original, and recomposes the exact overlay | Yes | Replaces original and final creative asset groups |
| Fact check | Re-runs server compliance and verifies every primary source URL against persisted safe sources | No | Approval/schedule is cleared if the check fails |
| Template-only creative | Disabled for Social Media Manager generation and regeneration | No | Generate an original OpenAI visual or use an approved authentic product asset; failures remain visible |

The regeneration actions never publish. If OpenAI is not configured, every AI action returns a clear error and preserves the existing package. Manual field editing remains available, but a normal full-AI draft cannot become review-ready without validated original OpenAI artwork.

### 5. Inspect the creative

The creative preview is not sufficient on its own. Generate or regenerate the image, then inspect both the original AI visual and every final composed asset at full size.

Confirm:

- Exact approved copy is present and in the intended order.
- Text is legible, not clipped, and inside safe areas.
- Contrast and dimensions passed.
- The Pink Paisa logo and brand treatment are correct.
- An AI-generated carousel has between three and seven ordered slides.
- A single-image format has exactly one asset.
- Alt text accurately describes the image.
- Provenance and usage rights are acceptable.
- Any manual-review flags are genuinely resolved.

For eligible new `FULL_AI_GRAPHIC` creatives, OpenAI creates the complete scene, exact approved on-image text and Pink Paisa identity. Independent vision validates the ordered text manifest and mobile-safe brand rendering; Sharp then performs resize/encoding-only normalization and applies no pixel overlay. Non-product Stories use this AI-native contract too: required Story copy, sequence label, CTA and disclaimer are baked into and validated in the original image because Stories publish without captions. Authentic product/affiliate creatives retain the protected exact-overlay contract so verified catalogue pixels and mandatory disclosure treatment remain deterministic. CTA and disclosures stay in the canonical feed/Reel caption, with the documented Story on-frame exception. Historical `FULL_AI_GRAPHIC` v1 branded-finish assets remain readable and truthfully labelled.

Clicking **Approve** also records approval of active assets that required manual review. That makes the administrator's visual inspection before approval essential.

### 6. Submit for review

**Submit review** is available for a `DRAFT` or `REJECTED` draft after editorial blockers are cleared. The server requires:

- A compliant primary recommendation.
- At least one active creative asset.
- No active asset with `validation_status=invalid`.

The draft moves to `NEEDS_REVIEW`. If reviewer emails are configured, the system sends a draft-ready message when the draft is first generated; email is a convenience, not an approval control.

### 7. Approve or reject

**Approve** is available only in `NEEDS_REVIEW`. The server requires an administrator identity, a passing compliance scan, active assets, and no invalid or manually rejected asset. Approval is bound to the exact current `revision`.

The default policy permits the same administrator to create and approve a draft. If Pink Paisa requires four-eyes review, enforce separate operator accounts and process policy; the current application does not enforce distinct creators and approvers.

**Reject** requires a reason and is available before publishing. Rejection clears approval and schedule state and records the reason in the audit trail. A `PUBLISHING` or `PUBLISHED` draft cannot be rejected.

### 8. Schedule or publish

**Schedule** requires:

- `APPROVED` status.
- Approval of the current revision.
- A valid future timestamp.

The stored schedule is an absolute timestamp with `Asia/Kolkata` recorded as the operating timezone. The browser's date/time control uses the operator's local browser timezone when converting to an ISO timestamp, so double-check the displayed intended time when administering from another timezone.

Scheduling is explicit publication intent. When the Instagram publishing master gate is enabled, the worker publishes a due scheduled draft even if the separate `auto_publish` setting is false. Nothing is scheduled or approved by generation itself.

**Publish now** asks for confirmation, performs server readiness checks, stores an idempotent publication intent, and returns HTTP 202. The durable marketing worker atomically claims that intent, persists provider checkpoints, and records the real Instagram result. This avoids an admin request timing out during a long carousel publish. There is no simulated or dry-run success response.

HTTP 202 means **queued**, not published. Refresh the draft and inspect its publication/audit state until it reaches `PUBLISHED`, `FAILED`, or `UNCERTAIN`. Only `PUBLISHED` with a real Instagram media ID is success.

The installed publisher supports:

- `CAROUSEL` with three to seven AI-generated assets (the installed Meta adapter technically supports up to ten for legacy packages).
- `SINGLE_IMAGE`, `INFOGRAPHIC`, `MEME`, `QUIZ`, and `POLL` with one asset.

It blocks `REEL` and `STORY`. Export those packages for a manual production workflow until an adapter is installed.

## Lifecycle reference

| Status | Meaning | Normal next action |
| --- | --- | --- |
| `DRAFT` | Editable, unapproved working package | Edit/render, then submit for review |
| `NEEDS_REVIEW` | Compliance and minimum creative checks passed | Inspect and approve, or reject |
| `APPROVED` | Current revision and active assets approved | Schedule or publish now |
| `SCHEDULED` | Approved with a future publication time | Worker publishes when due, or edit to return to draft |
| `PUBLISHING` | Provider call is in progress | Wait and inspect publication/audit state; do not duplicate |
| `PUBLISHED` | Instagram returned a real media ID | Verify permalink and record metrics |
| `REJECTED` | Administrator rejected with a reason | Edit and resubmit, or leave archived in history |
| `FAILED` | Generation/creative/publication workflow recorded a terminal or retriable failure | Follow the recovery section and preserve checkpoints |

Editing a published or currently publishing draft is blocked. To create a new package from an old post, use **Duplicate draft**.

Publication intent has its own durable status in addition to the draft lifecycle:

| Publication status | Meaning |
| --- | --- |
| `QUEUED` | The payload-locked intent is stored and waiting for the worker |
| `VALIDATING` | A worker owns a live lease, readiness passed for this attempt, and provider preparation is beginning |
| `CONTAINER_CREATED` | Instagram container IDs are checkpointed, but the media-publish checkpoint has not been crossed; an expired lease is safe to resume |
| `PUBLISHING` | The pre-media-publish checkpoint was persisted; an expired lease is treated as an uncertain external outcome |
| `PUBLISHED` | A real Instagram media ID was checkpointed; the worker also reconciles an interrupted draft save without making another provider call |
| `FAILED` | The attempt failed; `next_retry_at` indicates whether the worker will retry |
| `UNCERTAIN` | Instagram may have accepted the media-publish request; automatic retry is permanently stopped for this intent |
| `CANCELLED` | Schema-reserved state; the current admin UI and API expose no publication-cancel transition |

`publishing.retry_limit` counts retries after the initial attempt. The default is three retries, so a new publication stores `max_attempts=4`.

## Duplicate draft

**Duplicate draft** creates a new unapproved draft and a completed backfill run for the current Asia/Kolkata date. It:

- Links back to the source draft.
- Rewrites the package generation date.
- Generates fresh UTMs.
- Carries forward source and prompt references.
- Flags the copy as requiring a materially different angle review.
- Renders a new creative asset group.
- Starts at `DRAFT` with no approval or schedule.

Do not use duplication to repost substantially identical content. Review duplicate analysis and deliberately change the angle.

## Publishing readiness

The Today banner gives feature-level readiness. The per-draft API `GET /api/social-media-manager/admin/drafts/:id/publishing-readiness` gives authoritative publication blockers.

| Blocker code | Resolution |
| --- | --- |
| `draft_missing` | Reload the draft list; the requested draft no longer exists |
| `publishing_disabled` | Enable both the server environment flag and persisted `INSTAGRAM_GRAPH` settings after completing the deployment gate |
| `approval_policy_invalid` | Restore `approval.require_human_approval=true` |
| `approval_required` | Submit and approve the current revision; old-revision approval is invalid |
| `draft_status_invalid` | Use an eligible `APPROVED`, `SCHEDULED`, or publication-`FAILED` draft; otherwise move it through review again |
| `format_not_publishable` | Use a supported still-image/carousel format or export manually |
| `compliance_failed` | Fix every returned risk flag and rerun Fact check |
| `affiliate_product_unverified` | Restore the exact verified product ID/title and canonical `/product/<slug>` landing page, and confirm the catalog record is still active, visible, not archived, affiliate, compliant, has a nonempty affiliate URL, and is rights-cleared |
| `caption_length_invalid` | Supply or shorten the complete assembled caption—not only the editor caption—until disclosure, caption, CTA, disclaimer, and hashtags are nonempty and total no more than 2,200 characters |
| `landing_page_invalid` | Use a public first-party Pink Paisa destination |
| `creative_missing` | Render an active creative |
| `asset_count_invalid` | Use exactly one still image or three to seven slides for a newly AI-generated carousel; inspect legacy package limits separately |
| `creative_validation_pending` | Resolve validation and manual-review requirements, then approve |
| `asset_url_not_public` | Correct `PUBLIC_MEDIA_BASE_URL`, HTTPS, Nginx, and file availability |
| `instagram_not_connected` | Connect the intended Instagram professional account |
| `instagram_permission_missing` | Reconnect with a supported content-publish scope |
| `instagram_account_mismatch` | Connect the account named by `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID`, or correct the pin deliberately |
| `instagram_token_expired` | Reconnect or refresh the account |
| `schedule_invalid` | Correct the stored scheduled timestamp |
| `schedule_not_due` | Wait for the scheduled time; Publish now intentionally evaluates the immediate path instead |
| `already_published` | Do not retry the same draft; verify the recorded media ID/permalink |
| `publish_in_progress` | Another worker owns an unexpired publication lease; wait and refresh instead of creating a second intent |
| `publish_outcome_uncertain` | Stop; inspect Instagram and escalate for manual reconciliation because this intent cannot be auto-retried |
| `publish_retry_limit_reached` | Fix the provider issue, then use a deliberately reviewed duplicate draft only if a new publication is appropriate |

Do not treat a warning in the general Today banner as proof that a particular draft is publishable. Always use per-draft readiness immediately before a controlled publish.

Two payload-lock errors can occur after readiness: `publication_payload_changed` means the approved caption/assets no longer match the existing intent, and `publication_intent_conflict` means a competing intent already exists for the draft. Preserve the original publication and investigate; do not bypass either error with direct database edits.

## Research and fact checking

For every current claim, verify:

- The source title and URL correspond to the claim.
- The URL is a direct, credible page rather than a search result.
- Publisher, publication date, freshness, and confidence are reasonable.
- `validation_status` is `VALID`.
- `is_safe_to_use` is true.
- `prompt_injection_suspected` is false.
- The source is actually marked as influencing the selected recommendation.

OpenAI web research sources are accepted only when their canonical URL appears in the web-search tool evidence. Trusted RSS sources are fetched through an HTTPS/DNS/redirect/size-limited collector. Both paths sanitize untrusted text and reject instruction-like content.

**Fact check** compares primary recommendation source URLs with persisted validated source records and reruns deterministic compliance. It does not independently prove that an article is true or replace an expert reviewer. Finance, regulatory, health, and affiliate claims still need human source review.

## Compliance rules administrators must preserve

The server blocks, among other things:

- Guaranteed, assured, risk-free, double-your-money, or get-rich-quick outcomes.
- Personalized buy/sell/invest/redeem instructions.
- Unsupported stock or market predictions.
- Unsupported treatment, cure, diagnosis, or clinical claims.
- Financial educational content without the configured disclaimer.
- Affiliate content without a clear disclosure.
- Affiliate content that does not retain one exact verified catalog product ID/title; publishing also reloads that record and rechecks its active, visible, compliance, URL, usage-rights, and canonical landing-page state.
- Affiliate price, rating, review-count, discount, availability, stock, or delivery claims in the current manual-safe mode.
- Time-sensitive claims without at least one source.
- External or administrative landing pages.
- Incorrect Instagram organic UTM source/medium.
- Instruction-like prompt-injection text.

These are defense-in-depth rules, not legal, investment, medical, or advertising advice. The approving administrator remains accountable for the final post.

## Settings

The Settings tab exposes:

- Brand promise and target audience.
- Seven content-pillar ratios. Enabled ratios must total exactly 100%.
- Financial and affiliate disclosures.
- Daily generation and default posting time in Asia/Kolkata.
- AI and image model names.
- Monthly currency budget and per-run retry caps.
- Duplicate lookback window.
- UTM source, medium, and campaign prefix.
- Reviewer email addresses.
- Trusted and blocked research domains.
- The `auto_publish` preference when master publishing and Instagram readiness allow the control.

Human approval is fixed on in the UI. Saving settings records field-level changes in the Social audit log.

The master publishing values `publishing.enabled` and `publishing.provider` are not exposed as casual UI toggles. They require the environment gate plus an authenticated admin settings API update described in [the setup guide](social-media-manager-setup.md#controlled-publishing-activation).

Changing `auto_publish` does not bypass approval and does not cause generated drafts to schedule themselves. Leave it false unless a later reviewed workflow explicitly consumes it.

## Export

**Copy package** copies the caption package for manual use. **Export JSON** downloads a client-side snapshot containing the selected draft ID, status, date, timezone, primary and alternative recommendations, scheduled time, and assets.

Export does not approve, schedule, publish, lock, or modify the server draft. Treat exported files as potentially stale as soon as the server draft changes.

## Performance snapshots

The Performance tab allows manual snapshots for approved, scheduled, or published drafts. Available fields include:

- Reach, impressions, likes, comments, saves, and shares.
- Video views, video completions, and completion rate.
- Profile visits, follows, website clicks, and landing sessions.
- Affiliate CTA clicks.
- Quiz starts/completions and calculator opens.
- Workshop enquiries and product-page visits.
- Negative feedback.

Enter at least one non-negative metric, an optional capture time, and a provenance/context note. Completion rate is entered as a percentage in the UI and stored as a 0–1 fraction.

Each snapshot is immutable. Corrections require a new snapshot rather than overwriting history. The Performance history shows snapshots for the selected draft. The server's aggregate performance endpoint uses the latest snapshot per published draft over a 1–365 day window and groups directional signals by pillar and format.

Treat performance as correlation, not causation. The decision engine also applies content and format rotation so one superficially high-performing topic does not dominate the feed.

## Audit trail

The Audit tab returns the newest 100 draft-related events. Events can include:

- Generation queued, completed, failed, or deliberately retried; legacy audit rows may still identify historical fallback use.
- Prompt stages, provider/model references, and token usage.
- Source and prompt-version references.
- Field-level edits.
- Creative regeneration and validation status.
- Fact-check results.
- Submit, approve, reject, and schedule actions.
- Publication started, blocked, failed, uncertain, or published.
- Metric snapshot creation.

The application does not store private chain-of-thought. Audit records are append-only through the application model. Report suspected gaps or tampering to the system owner; do not delete records to clean up a failed workflow.

## Failure recovery

### Generation is pending

1. Refresh Today once.
2. Check whether the generation run is `PENDING` or `RUNNING`.
3. Confirm `pinkpaisa-marketing-worker` is online.
4. Inspect worker logs for Mongo, provider, disk, or settings errors.
5. Allow the lease/retry mechanism to recover the run; do not create many forced revisions.

### Generation failed

Review `last_error`, current stage, text revision attempts, image attempts, and Audit. Compliance exhaustion ends as `FAILED_COMPLIANCE`; image exhaustion ends as `FAILED_IMAGE_GENERATION`. Fix the setting/provider/input cause, optionally add administrator direction, then deliberately retry. No deterministic evergreen draft or template-only creative is created. When timely evidence is weak, the AI itself may choose an evergreen opportunity, but it still authors the strategy and copy.

### Creative failed or became stale

Correct invalid copy, verify OpenAI image access, disk write permissions, and `PUBLIC_MEDIA_BASE_URL`, then use **Regenerate image**. Inspect original/final provenance and approve only when the original OpenAI asset, exact composition, and visual safety checks are legitimate.

### Scheduled post did not publish

Check:

- The publishing master environment and persisted setting.
- Worker health and scheduler logs.
- Per-draft readiness.
- Scheduled timestamp.
- Instagram connection, scope, token expiry, and expected account ID.
- Public HTTPS availability of every asset.
- Publication `next_retry_at` and checkpoint.
- Publication `attempt_count` versus `max_attempts`, plus `lease_owner`, `lease_expires_at`, and `heartbeat_at`.

Retriable failures are picked up by the worker. Do not change assets or caption after approval to force a retry; payload changes are blocked against an existing publication attempt.

If an attempt becomes stale in `VALIDATING` or `CONTAINER_CREATED`, leave it in place: the worker changes it to `FAILED` with an immediate retry and resumes from its safe checkpoint. If a `PUBLISHED` publication with a real media ID exists while the draft is not published, keep the worker running; it reconciles the draft without calling Instagram again.

### Publication outcome is uncertain

Stop. Do not press Publish again and do not duplicate the draft. Check the actual Instagram account and provider state for the container/media ID. The system intentionally does not auto-retry uncertain outcomes because that could create a duplicate post. Preserve the publication and audit records for reconciliation.

The current admin UI has no force-retry or resolve-uncertain action. Record the external finding and involve the application owner in a controlled reconciliation; never change publication status directly as an informal workaround.

### A published post is wrong

The application cannot safely pretend the publish did not happen. Follow Pink Paisa's incident policy on Instagram, disable the publishing master gate if systemic risk exists, preserve audit evidence, and create a corrected new draft through the full review process.

## Admin API summary

All paths below are prefixed with `/api/social-media-manager` and require admin auth.

| Method and path | Purpose |
| --- | --- |
| `GET /admin/today` | Today's latest draft, run, and feature readiness |
| `POST /admin/generate` | Queue/reuse a manual daily run; accepts `force` and an idempotency header |
| `GET /admin/drafts` | Paginated calendar list with status/date filters |
| `GET /admin/drafts/:id` | Full draft relations, sources, audit, metrics, and publication |
| `PATCH /admin/drafts/:id` | Replace the package or primary recommendation and revalidate |
| `POST /admin/drafts/:id/submit-review` | Move a ready draft to review |
| `POST /admin/drafts/:id/approve` | Approve current revision and active assets |
| `POST /admin/drafts/:id/reject` | Reject with required reason/notes |
| `POST /admin/drafts/:id/schedule` | Schedule an approved revision in the future |
| `POST /admin/drafts/:id/publish` | Queue a guarded durable Instagram publication intent; returns HTTP 202 and the worker performs the provider call |
| `POST /admin/drafts/:id/duplicate` | Create a fresh unapproved copy |
| `POST /admin/drafts/:id/regenerate` | Regenerate `alternatives`, `hooks`, `caption`, `visual`, or `fact_check` |
| `POST /admin/drafts/:id/assets/render` | Render exact-copy active assets |
| `POST /admin/drafts/:id/fact-check` | Direct fact-check alias |
| `GET /admin/drafts/:id/publishing-readiness` | Authoritative per-draft blockers |
| `POST /admin/drafts/:id/metrics` | Add an immutable metric snapshot; supports an idempotency header |
| `GET /admin/performance` | Directional aggregate performance for `days=1..365` |
| `GET /admin/settings` | Persisted settings plus feature readiness |
| `PUT /admin/settings` | Partial settings update with validation and audit |

Cookie-authenticated POST, PUT, and PATCH requests require the current signed `X-CSRF-Token`. The frontend handles this automatically.
