# Pink Paisa Social Media Manager administrator guide

Use this guide for day-to-day operation of Admin -> Social Media Manager. The workspace supports planning, AI production, human review, scheduling, real publication tracking, aggregate analytics and human-approved community replies.

## Non-negotiable operating rules

- The AI proposes strategy, format, copy and imagery; an administrator remains accountable for accuracy, disclosure, rights, tone and publication.
- Approving the weekly plan atomically queues every selected creative. Approve and schedule each current draft revision and its active assets before publishing.
- Never interpret a spinner, HTTP 202, queued record or n8n success as a published Instagram post. Require a stored `PUBLISHED` state with a real provider ID/permalink.
- Do not clear or hide failed AI/compliance/image/publication states. Read the attempts and error, then retry only when the cause is understood.
- The default maximum is three non-Story feed posts per Asia/Kolkata week. This is a business/content-quality invariant, not an API throttle.
- There is intentionally no Social Media Manager or Instagram-integration request-count throttle. Repeated clicks are still a poor operating practice: use the visible run/plan state and idempotent actions rather than creating unnecessary provider cost.
- Auto-publish, auto-reply, auto-DM and auto-hide-spam start disabled. Do not enable them during the initial production rollout.
- Version 3 disables automatic daily draft generation by default so the approved weekly plan is the single automatic content stream. Manual Creative Studio generation still works. Re-enable the daily schedule only as a deliberate operating-model change and continue to respect weekly publication capacity.

## The five-workspace interface

| Workspace | What belongs there |
| --- | --- |
| **Strategy** | Weekly plan and collapsed research evidence |
| **Content** | Attention queue, one-off creation, list/calendar switch, manual actions and the shared review drawer |
| **Results** | Published posts, aggregate analytics and manual metric snapshots |
| **Community** | Human-approved comment, mention and message work |
| **Setup** | Connections, operating settings and licensed Reel audio |

The normal operator path is:

`Automatic plan -> Approve plan -> Review/approve each creative -> Automatic publish and metrics`

For a normal three-post week this is exactly four human decisions: one strategy approval and three individual final-creative approvals. There is no normal **Produce creative**, date/time entry, drawer reopening, **Submit for review** after a safe edit, **Approve only**, **Collect metrics**, **Check connections** or **Publish now** step. Recovery and legacy endpoints remain available under Advanced or on a visible failure. Human approval is still mandatory at the strategy and final-creative boundaries; bulk final approval is intentionally unavailable.

## Truthful visual modes

| Mode | Result | Eligibility |
| --- | --- | --- |
| `AI_VISUAL_WITH_EXACT_OVERLAY` | OpenAI artwork plus verified programmatic headline/supporting copy/logo | Required fallback for Stories and authentic product/affiliate creatives; also available as an explicit precision mode |
| `AI_ARTWORK_ONLY` | Full-bleed OpenAI artwork normalized only by Sharp; no composited text, logo, watermark, branding or reserved text area | Only non-product `SINGLE_IMAGE`/`CAROUSEL` awareness, education, engagement or community-building posts |
| `FULL_AI_GRAPHIC` | Complete AI-native artwork, exact approved text and Pink Paisa identity; Sharp performs resize/encoding-only normalization and adds no pixel overlay | Recommended default for eligible new creatives |

Artwork-only is rejected for products, affiliate content, traffic/leads, promotions, resources/events/workshops, Stories, Reels and videos. `FULL_AI_GRAPHIC` is rejected for Stories and authentic product/affiliate creatives, which resolve to exact-overlay mode so Story disclosure copy and verified catalogue pixels remain deterministic. A manually requested ineligible mode returns `social_visual_mode_ineligible`. During weekly planning, an ineligible default is visibly resolved to exact-overlay mode with its reason before approval. For artwork-only, the system preserves both the OpenAI original and normalized final, validates that no text/logo/watermark is visible, and retries only the failing image. Stories always keep required disclosure/CTA text on-frame.

New `FULL_AI_GRAPHIC` assets use contract version 2. The complete ordered visible-text manifest is included in the image prompt and independently validated after normalization for exact text, Pink Paisa identity, mobile legibility, safe area, unapproved text and unrelated marks. The normalized AI bytes are the final image bytes: provenance must show `renderer: openai_generated_graphic_passthrough`, `overlay.method: none`, `pixel_overlay_applied: false` and `normalization.renderer: sharp_resize_encode_only_v1`. Historical contract-version-1 assets remain readable and are labelled as an AI-rendered headline with a branded overlay finish; they are not relabelled as overlay-free.

### Pink Paisa creative system

New creative generation uses only the two administrator-selected art directions. **Premium editorial icon grid** is the primary system for educational, informational, product and news-context work. **Bold editorial collage** is the secondary system for engagement, community, relatable-money, quiz, poll and meme work. A carousel keeps one direction across all slides while varying its subject, setting or action.

Both directions require topic-specific informative icons and integrated editorial composition. New prompts explicitly reject stock-like desk/laptop/coffee/plant scenes, washed-out finance banners, oversized floating white cards and generic rounded template panels. In the recommended native mode, the AI renders the complete editorial layout and exact text inside one image. Protected exact-overlay creatives place verified copy in style-aware editorial fields rather than the retired full-width rounded card. Existing historical creatives remain readable and unchanged; use visual-direction regeneration when an older stock-desk original must be replaced with the selected system.

## Caption policy

Feed posts and Reels use one completed caption in this exact order:

`Affiliate disclosure -> Caption -> CTA -> Financial disclaimer -> Hashtags`

Required components must appear exactly once and the assembled result must be at most 2,200 characters. Approval is bound to the caption checksum. CTA and disclosures are not placed on new feed/Reel imagery. Stories are the exception because Instagram Stories publish without captions: affiliate disclosure is rendered on the first frame, while CTA and the general disclaimer are rendered on the final frame.

## Failure recovery

- Weekly approval either approves and queues every selected item in one transaction, or rolls back the entire change and leaves the plan in `NEEDS_REVIEW`.
- A failed item exposes its specific retry; successful or already-queued items are reused idempotently.
- **Approve & schedule** validates compliance, caption checksum, assets/provenance, visual eligibility, future time and weekly capacity before one transaction. A failure leaves draft, assets, weekly plan and audit history unchanged.
- Caption-only edits retain imagery, increment the revision, rerun checks and return directly to `NEEDS_REVIEW`. Exact-overlay on-image copy edits recompose from the retained original without a new image call. Because native v2 text is part of the AI-rendered pixels, changing its on-image text requires generation and validation of a fresh AI-native image; it must never be patched with a manual overlay. Carousel recovery can target one slide.
- Selecting a different rights-confirmed Reel/Video Feed track in the review drawer rebuilds from retained frames, invalidates prior approval and returns directly to review without an image-generation call.
- `PUBLISHING` is wait-only. Publishing errors arrive on a generic `FAILED` draft with `last_error.stage` and publication status (`FAILED`, `BLOCKED`, or `UNCERTAIN`) identifying the recovery path; never create a duplicate publish blindly.

## 1. Setup: Connections

Open Connections before the weekly planning session and after any credential, permission or provider change.

1. Connection status loads automatically. Use **Advanced -> Check connections now** only after a credential/permission change or when a visible failure asks for a retry.
2. Confirm the expected account/property identifier, not only a green-looking status.
3. Inspect the capability chips and limitations for OpenAI, Instagram/Meta, GA4, Search Console, n8n and research.
4. Resolve `NOT_CONFIGURED`, `MISCONFIGURED` or `ERROR`. `CONFIGURED` only means that setup material was found; a successful authenticated call is required for `CONNECTED`.
5. Never paste a token or service-account JSON into a caption, prompt, browser field or support message. Secrets are configured server-side.

For Instagram, verify username, professional account type, account ID, granted scope and token expiry. The current connection flow is Instagram Login; a displayed Facebook Login capability family is not proof that the unimplemented Page-token OAuth path is available.

For GA4/Search Console, compare the exact property IDs with Google. A zero-row result can be legitimate; an authentication/permission error is not.

## 2. Strategy: Weekly plan

Weekly Strategy is the control point for the next Asia/Kolkata week.

1. The weekly plan is generated automatically. If the server is offline during the configured minute, the next scheduler tick catches up that configured weekly occurrence idempotently; a restart cannot create a second plan for the same week. **Generate plan manually** stays under Advanced and appears as normal recovery only when automatic planning genuinely fails.
2. While the plan is queued/running, watch its automatically loaded state instead of requesting another plan.
3. Review the research summary, audience problem/opportunity, previous performance, candidate set, selection rationale, content balance, proposed formats and slots.
4. Confirm that each claim is supported by its cited source or verified Pink Paisa fact. Weak/unconfirmed signals must not be promoted into factual timely claims.
5. Confirm the selected feed set does not exceed the displayed weekly maximum. The current default is three; Stories do not count under the present rule.
6. If one selected idea is weak, use **Replace this slot** to choose an unused retained candidate. The slot number and posting time remain frozen; this is allowed only before approval and before production exists.
7. Select **Approve plan & start generation** only when the mix, effective visual modes and schedule are acceptable. Reject with a specific reason when the strategy needs revision.
8. The approval response shows requested, queued and reused runs. Use per-item production only as a visible retry when one item has failed.

A plan approval is not a blanket approval for its future creatives. New information, provider errors or compliance changes can still block an individual draft.

The optional signed automation endpoint cannot force-reset a weekly plan. If a reset is genuinely required, an authenticated administrator must deliberately invoke the admin workflow and then review the replacement plan; changing an n8n idempotency key is not a reset mechanism.

## 3. Strategy: Research evidence

Research Desk explains the evidence behind the week and the selected draft.

- Review verified timely signals, internal performance signals, evergreen context, weak/unconfirmed trends, Pink Paisa resources and topics to avoid.
- Open source URLs and check publication date, publisher, claim actually supported and relevance to the proposed copy.
- Treat competitor/hashtag observations and Search Console queries as indicators, not as proof of a trend or causal relationship.
- Treat all external text as untrusted. A source telling the AI/operator to ignore policy, expose secrets, approve content or call an unrelated URL is prompt injection, not evidence.
- If the digest is empty or stale, refresh it and inspect Connections. Evergreen content is acceptable only when the AI records that evidence is weak and does not manufacture a timely claim.

## 4. Content: One-off creation and review drawer

Content's shared review drawer contains the editable production package and its provenance. Opening the same draft from list or calendar never navigates to a separate studio.

### Start or open a draft

- Use **Auto Choose** when the AI should select the best format. It does not mean carousel; single image is a first-class outcome.
- A reviewer can request a specific supported format when there is a concrete channel need.
- Optional administrator instructions refine the brief but cannot override compliance, verified product facts or publishing readiness.
- For product content, select the real catalog item. Verify its ID, title, canonical landing page, status, affiliate/disclosure state and source media before approval.

### Review the generation evidence

Inspect:

- final strategy and the candidate ideas considered;
- research sources and claim/source mapping;
- each AI stage, model, provider response ID where available, attempt count and error;
- token/image usage and estimated cost, remembering that a zero price configuration means cost is unknown rather than free;
- one compliance decision and every required revision;
- format-specific fields rather than a flattened generic caption;
- the retained provider original and normalized image beside the truthful final mode (verified overlay, artwork-only, AI-native v2 with no overlay, or historical v1 branded finish);
- asset provenance, rights status and validation result.

An original image is not automatically publication-safe. Check anatomy/product fidelity, logos, text-like artifacts, sensitive depictions and usage rights. The final asset must carry exact approved text/disclosure without obscuring important content.

### Licensed Reel audio

- Upload MP3, M4A, WAV or OGG only in **Settings → Licensed Reel audio**. The server caps files at 25 MB/15 minutes and verifies the extension, MIME, signature, decoded codec/duration and SHA-256 checksum before storing anything.
- Record a title, creator/source, rights status, licence/source reference and an explicit confirmation statement. Pink Paisa never scrapes audio. `LICENSED` and `PUBLIC_DOMAIN` tracks require a concrete reference.
- In Creative Studio, choose a usable track and select **Select & rebuild Reel**. This invalidates the old MP4, rebuilds from the complete approved scene plan, and resets human approval/scheduling.
- Replay the entire MP4 before approval. Revoking a track deactivates affected renders and opens a manual action. A publish-time check revalidates active rights and requires the MP4 audio checksum to match the selected library record.
- Library originals are private and are previewed only through the authenticated admin stream. Final approved Reel MP4s remain separately stored at their Meta-accessible public URL.

### Granular regeneration

Use the narrowest action that matches the problem:

- Strategy: rethink topic/angle/evidence direction.
- Copy: rewrite format-specific copy while keeping the approved strategic direction where possible.
- Image: regenerate the visual without silently rewriting approved copy.
- Format: change the content format and regenerate the fields/assets that the format requires.
- Revision: apply written reviewer feedback.
- Compliance: rerun the independent compliance/revision path.

Any material change can return the draft to an unapproved state and deactivate stale assets. Re-review the whole active package; never rely on an approval badge from an earlier revision.

### Failure handling

Common visible failures include research, generation, compliance, image generation and publishing. Read the run stage and provider attempt details.

- Missing/invalid AI output: confirm OpenAI connection, configured model access and schema error; retry the failed run only after correction.
- Compliance exhaustion: revise the claim/copy or regenerate; do not manually mark it passed.
- Image exhaustion: correct the visual brief/product reference/rights issue and regenerate image. Do not substitute an untracked local template.
- Native v2 poster failure: inspect the independent exact-text/brand/mobile-legibility issues and regenerate only the failing image; never repair it with a manual overlay.
- Exact overlay failure: inspect copy length/safe area and render again after correcting the package.
- Product-fact failure: refresh from the catalog and remove unsupported claims.

A failed run must not have a completed draft. Escalate any state that shows both a terminal failure and a completed/approvable package.

## 5. Content: Attention queue

Content opens on **Needs Action**, ordered as final creative review, terminal failure, unresolved manual action, then generation/waiting. Badges show actionable work rather than historical totals. Published and scheduled history remains available through filters and Calendar.

The review drawer is a queue runner. A successful **Approve & schedule** uses the frozen weekly slot without asking for a date, then replaces the drawer contents with the next `NEEDS_REVIEW` creative. If generation is still running, the active review session waits and opens it automatically. After the last creative, the drawer shows **All weekly creatives reviewed** with direct Calendar navigation.

Before **Approve & schedule**:

- current revision, format-specific copy and CTA are complete;
- claims have supporting sources and verified product facts still match;
- compliance is `PASS` with no unresolved required changes;
- affiliate/financial/wellness disclosures are appropriate and prominent;
- original and final assets are present, valid, rights-cleared and correctly ordered;
- destination is first-party and reachable where required;
- schedule does not violate the weekly feed maximum;
- the intended Instagram connection/capability is healthy.

Reject with an actionable reason. Editing/regenerating in the review drawer is preferable to approving with an informal promise to fix later.

Caption, CTA, disclosure, hashtag, alt-text, exact-overlay, Story-composition and retained-frame video/audio edits return directly to final review after saving and rechecking. A separate **Submit for review** is used only by historical/API clients. The normal drawer keeps media, canonical caption, compliance/readiness, frozen schedule and the state-derived action visible; editing, prompts, provenance, cost and history are collapsed.

**Advanced -> change frozen time** is an exception, not a normal step. It requires a reason, must stay within the same Asia/Kolkata plan week, rechecks capacity, updates draft and plan item atomically, and records old/new time plus reviewer in the immutable audit trail. It does not reopen strategy approval.

Audit detail records lifecycle actions and errors, but it intentionally does not expose hidden model chain-of-thought.

## 6. Content: Calendar

- Use the calendar to view draft, review, approved, scheduled, publishing, published and failed items in IST.
- Schedule only an approved current revision.
- A due `SCHEDULED` draft is explicit publish intent when the master publishing gate is enabled; the separate auto-publish preference is not an extra schedule gate.
- The server checks the weekly publication maximum again at schedule/publish time. Do not move records directly in MongoDB to create capacity.
- A final schedule change uses only the audited same-week Advanced override in the review drawer; never edit MongoDB directly.

## 7. Results: Published posts and analytics

Metrics are collected automatically at due intervals. **Advanced -> Collect metrics now** is for failure recovery or an explicit diagnostic refresh, not a normal weekly step. Failed or uncertain publication outcomes remain visible above analytics. For an uncertain outcome, inspect Meta first and enter the authoritative existing media ID (and permalink when available); reconciliation updates Pink Paisa without issuing another publish request.

- Evaluate reach, saves, shares, meaningful engagement, qualified traffic and conversions together; likes alone are not a growth objective.
- Use the per-post provider permalink to confirm the external outcome.
- Treat GA4/Search Console/Instagram attribution as directional where identity and cross-platform attribution are unavailable.
- Manual snapshots are immutable observations. Correct a bad input by recording a new evidence-backed snapshot, not rewriting history.
- AI learning summaries must cite aggregate observations and must not infer private audience attributes or causation from weak correlations.

If the connection is unavailable, the UI should show partial/error status rather than zeros presented as real measurements.

## 8. Community: Inbox

Supported routine events queue AI drafting automatically; this never sends anything. The normal safe sequence is one editable **Approve & send** decision.

1. Read the original item and open its provider permalink when available.
2. Review AI classification, confidence, risk flags and escalation recommendation.
3. For a routine safe item, edit the AI recommendation if needed and select **Approve & send** once.
4. The exact approved reply and checksum are committed atomically to a durable send intent.
5. `SEND_QUEUED`/`SEND_PROCESSING` is not success. Confirm `SENT` only after Meta returns a real reply identifier.

Do not use the AI reply for emergencies, medical/legal/financial advice, threats, self-harm, personal-data requests, payment/order disputes requiring customer lookup, harassment or uncertain policy issues. Mark/escalate and move the conversation to the approved human support channel.

Sensitive, high-risk, unsupported or uncertain items are escalated with no send action. Acknowledge the escalation with an ownership note, complete the verified human handling, then resolve it with an outcome note; neither action exposes a send control. If a provider outcome is uncertain, Pink Paisa never retries blindly: it creates a reconciliation action and requires the actual Meta reply/message ID before changing the item to `SENT`. Legacy Draft/Approve/Send endpoints remain under Advanced recovery. If the connected login/scopes do not support the requested operation, complete the work in Instagram/Meta and record the authoritative outcome; do not mark it sent merely because a draft, recipient ID or send intent exists.

Manual-action cards have direct **Complete** and **Cancel** controls for genuinely manual work—there is no ceremonial **Start** step. The system completes a linked action only when authoritative evidence proves resolution, and records `completion_source: SYSTEM` plus structured evidence. Uncertain publication/community reconciliation actions cannot be closed with a free-text completion note; use the dedicated Results/Community control so the confirmed provider ID, entity transition, action completion and audit commit together.

## 9. Setup: Settings and audio

Change one operational area at a time and record the reason.

- Brand/research boundaries: source allowlists, competitor/hashtag watchlists and topics to avoid.
- The Advanced connection check also refreshes approved Meta research watchlists when Hashtag Search and Business Discovery are genuinely available. With the current Instagram Login flow, Research Desk shows the permission/login-family limitation and makes no discovery request. Never work around it with Instagram scraping.
- Role models: use deployed, accessible models with schema support. Changing a name does not grant provider access.
- Weekly planning: candidate count, maximum feed posts, Sunday planning time, lead window and IST posting slots.
- Daily generation: leave the automatic daily schedule disabled for the version 3 weekly-team model. This switch does not disable manual Studio generation.
- Cost controls: configure reviewed current token rates and INR conversion or treat the displayed estimate as incomplete. Keep provider-side budgets/alerts.
- Publishing: environment kill switch and persisted setting must both allow publishing. Keep auto-publish false during controlled operation.
- Community: keep automatic reply/DM/hide settings false unless a separately approved policy and connector capability exists.
- Analytics intervals: snapshot timing is operational, not a promise that every provider metric is immediately available.

The settings UI cannot supply server secrets. Credential changes require the deployment runbook, process reload and live Connections check.

### Advanced: delete generated content

Use **Setup -> Advanced -> Generated-content cleanup** only when the unpublished Social Media Manager workspace must be cleared and restarted. This is a guarded recovery tool, not a routine housekeeping action.

1. Select **Review deletion**. The server returns a fresh preview with the exact database-record counts, exact local files and bytes eligible for deletion, protected/excluded records, and any blocker.
2. Read the preview before continuing. Cleanup is limited to unpublished Social Media Manager generation data, including eligible drafts, generation runs, assets, weekly plans, owned research records and linked-only manual actions.
3. Type the exact case-sensitive confirmation phrase `DELETE ALL GENERATED CONTENT`. The delete action remains disabled when the phrase is different, the preview contains no eligible records, or a blocker exists.
4. Run the cleanup once and review the result. Repeated requests with the same idempotency key reuse the recorded outcome instead of starting a second deletion.

The cleanup never deletes published or provider-in-flight content, publication evidence, immutable audit history, Social Media Manager settings, connection configuration/health, catalogue/products, audio-library records, prompt versions, community records, or shared Marketing campaign assets. External Instagram media is outside its scope. Historical generation cost remains represented in an append-only usage ledger, so deleting drafts or runs cannot reset the monthly AI-cost total.

Pending/running generation, publishing, or an uncertain active publication blocks cleanup until the authoritative workflow state is resolved. The service deletes only the exact storage keys shown by the preview and protects any file still referenced by published content or shared Marketing assets; it never wipes a campaign directory. Database cleanup commits before local-file removal. Missing files and individual removal failures are reported visibly, do not make the database result look fully successful, and can be retried safely through a new preview. Preserve the cleanup audit entries when diagnosing any partial file result.

## Status and incident shorthand

| State | Operator meaning |
| --- | --- |
| `QUEUED` / `PENDING` / `RUNNING` | Work exists; inspect worker progress before retrying |
| `NEEDS_REVIEW` | Complete enough for human review, not approved |
| `REVISION_REQUIRED` | Compliance/reviewer changes remain |
| `APPROVED` | Current stored revision approved; still subject to readiness checks |
| `SCHEDULED` | Approved explicit future publish intent |
| `PUBLISHING` | Provider workflow in progress; do not click again |
| `PUBLISHED` | Success only with a real provider ID/permalink |
| `FAILED_*` | Terminal stage failure is visible; diagnose and deliberately retry/regenerate |
| `UNCERTAIN` | Provider might have accepted publish; never auto-retry, reconcile manually |
| `MANUAL_ACTION_REQUIRED` / `ESCALATION_REQUIRED` | A human/provider tool must complete the operation |

For a suspected wrong-account post, secret exposure, fabricated product claim or duplicate/uncertain publication: disable publishing at both gates, preserve logs/records/assets, inspect Instagram, revoke/rotate credentials where appropriate, and follow the security/deployment runbooks.

## Related runbooks

- [Architecture](pink-paisa-social-growth-architecture.md)
- [Meta and Instagram setup](pink-paisa-meta-instagram-setup.md)
- [Security](pink-paisa-social-manager-security.md)
- [Deployment and rollback](pink-paisa-social-manager-deployment.md)
