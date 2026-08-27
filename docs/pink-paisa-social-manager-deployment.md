# Pink Paisa Social Media Manager deployment

This runbook deploys the Social Growth Team into the existing Pink Paisa Lightsail/Nginx/PM2 stack. It assumes the repository root is `/home/ubuntu/pinkpaisa`, Express listens on 5001, Next.js listens on 3000 and MongoDB is the application database.

Do not deploy the Social Manager as a separate dashboard, database or n8n-owned application.

## Release gates

Before the maintenance window:

- Review the code/config diff and ensure no live `.env`, Google JSON key, Meta token, n8n credential, generated upload or database dump is in the package.
- Run the server's Social Manager tests with provider calls mocked and the frontend type/lint/build checks used by the release.
- Confirm OpenAI text/image model access and provider budgets.
- Confirm MongoDB free space, application disk free space and write access to `server/uploads/generated/campaigns`.
- Confirm Node.js major version 22 and a writable MongoDB replica set named `rs0`; standalone MongoDB is a failed release gate because atomic approval/scheduling/edit/community workflows require transactions.
- Confirm a controlled Instagram professional test account and public HTTPS media path.
- Confirm an audited production `ffmpeg`/`ffprobe` installation, explicit executable paths, and working H.264 video plus AAC audio encoders.
- Select exactly one Social orchestration schedule owner. Internal PM2 is the default; n8n schedules must remain inactive while the internal owner flag is true.
- Schedule a human reviewer for the first weekly plan, first creative and first provider publication.

The weekly feed maximum (default five non-Story feed posts per Asia/Kolkata week) is a business invariant enforced by the server. It is not a request-count limit. Per the administrator directive, there is no Social Media Manager or Instagram-integration request-count throttle; do not add one during deployment or reintroduce the old SMM 429 message.

## 1. Back up state

Back up MongoDB and `server/uploads` from the same maintenance point. Use the existing Lightsail backup script and verify the resulting files are non-empty:

```bash
cd /home/ubuntu/pinkpaisa/server
DOTENV_CONFIG_PATH=./.env node -r dotenv/config -e "const {spawnSync}=require('node:child_process'); const result=spawnSync('bash',['/home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh'],{stdio:'inherit',env:process.env}); process.exit(result.status ?? 1)"
```

Do not source `.env` as a shell script. Load it with `dotenv` as above so values containing spaces or shell-significant characters are preserved literally.

Record:

- release commit/archive checksum;
- Mongo dump path and timestamp;
- uploads archive path and timestamp;
- current PM2 process list and saved environment-independent settings;
- current Social Manager persisted publishing/automation flags;
- current n8n workflow active states.

Do not deploy by replacing or deleting `server/uploads`. The deploy packaging script intentionally excludes it.

### Convert a standalone MongoDB host to `rs0`

If `db.adminCommand({ hello: 1 }).setName` is absent, the host is standalone and the release must pause for conversion. After the verified backup above, stop the API and marketing worker so there are no application writers. Preserve a copy of the exact MongoDB configuration, add the following reviewed block to `/etc/mongod.conf`, validate the YAML and restart MongoDB:

```yaml
replication:
  replSetName: rs0
```

Inspect `db.adminCommand({ hello: 1 })` again. Only when it is still uninitialized, initiate the single-node set once. Use the same stable local member address that the application will reach; the standard single-host Lightsail layout uses `127.0.0.1:27017`:

```bash
mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh --quiet --eval 'rs.status()'
mongosh --quiet --eval 'db.adminCommand({ hello: 1 })'
```

Do not call `rs.initiate()` if `hello.setName` or `rs.status()` already identifies a configured set. Wait until `rs.status()` reports `set: "rs0"` and the sole member is `PRIMARY`, then use the quoted replica-set URI in the production environment. If conversion fails, restore the reviewed MongoDB configuration and application state from the recorded maintenance point rather than repeatedly reinitializing the database.

## 2. Prepare production credentials and settings

Build `server/.env` from the current `server/.env.example` and the production template, then reconcile every Social Growth setting added by this release. The populated file must stay outside source control.

### Core and process ownership

```env
NODE_ENV=production
PORT=5001
MONGO_URI="mongodb://127.0.0.1:27017/pinkpaisa?replicaSet=rs0&retryWrites=true&w=majority"
SERVER_URL=https://pinkpaisa.in
PUBLIC_MEDIA_BASE_URL=https://pinkpaisa.in
FRONTEND_URL=https://pinkpaisa.in
PUBLIC_APP_URL=https://pinkpaisa.in

MARKETING_WORKER_IN_API=false
MARKETING_SCHEDULER_IN_API=false
SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
SOCIAL_AUDIO_LIBRARY_ROOT=/var/lib/pinkpaisa/social-audio-library
```

The PM2 ecosystem owns one API, one marketing worker and one frontend. Do not start the scheduler inside Express in addition to the marketing worker. `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true` makes that worker the sole owner of weekly-plan, prepublication and metrics scheduling. It does not control unrelated scheduler work.

### Full-AI and human approval baseline

```env
OPENAI_API_KEY=from_secret_store
SOCIAL_AI_FULL_GENERATION=true
SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK=false
SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK=false
SOCIAL_REQUIRE_HUMAN_APPROVAL=true
SOCIAL_REQUIRE_APPROVAL=true
SOCIAL_MAX_CONTENT_REVISIONS=3
SOCIAL_MAX_IMAGE_RETRIES=3
SOCIAL_DEFAULT_VISUAL_MODE=FULL_AI_GRAPHIC
SOCIAL_PRODUCT_IMAGE_ALLOWED_HOSTS=media.pinkpaisa.in,m.media-amazon.com,images-na.ssl-images-amazon.com,images-eu.ssl-images-amazon.com
SOCIAL_PRODUCT_IMAGE_MAX_BYTES=12582912
SOCIAL_PRODUCT_IMAGE_MAX_PIXELS=30000000

SOCIAL_MANAGER_ENABLED=true
SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false
SOCIAL_WEEKLY_PLANNING_ENABLED=true
SOCIAL_WEEKLY_CANDIDATE_COUNT=8
SOCIAL_MAX_FEED_POSTS_PER_WEEK=5
SOCIAL_TIMEZONE=Asia/Kolkata

SOCIAL_MANAGER_PUBLISHING_ENABLED=false
SOCIAL_MANAGER_AUTO_PUBLISH=false
SOCIAL_AUTO_PUBLISH=false
SOCIAL_AUTO_REPLY=false
SOCIAL_AUTO_DM=false
SOCIAL_AUTO_HIDE_SPAM=false
```

Use the current reviewed model names from `server/.env.example`. Provider/model availability must be verified in the deployed OpenAI project; changing a string in `.env` does not grant model access. Configure current token/image prices and provider budgets before relying on the in-app cost estimate.

Keep the product-image host list narrow and reviewed. Product creative generation fetches only the authoritative image URL on the active production Product record, disables redirects, pins a public DNS result for the request, validates MIME/magic signature/size/pixels/checksum, and stores the exact source bytes. OpenAI receives only a text-free, product-free background prompt; a mismatch or unsafe image fails the run visibly.

The foundation migration preserves a recognized persisted visual default. On an existing environment, verify the authenticated Social Manager settings response after migration and deliberately save `FULL_AI_GRAPHIC` if the administrator-saved value is still exact-overlay. Do not update unrelated settings or bypass the visible fallback: Stories and authentic product/affiliate creatives must continue resolving to exact overlay.

Version 3 deliberately makes the weekly plan the only automatic content-production stream. Its defaults and v2-to-v3 migration set daily automatic generation false; manual Studio generation remains available and an administrator may later re-enable the daily schedule as an explicit operating-model decision. Environment `false` values are deployment kill switches. Persisted Social Manager settings also have to allow a feature before it operates. Keep all publish/send automation false during the controlled rollout.

### Meta/Instagram

Follow [the Meta setup runbook](pink-paisa-meta-instagram-setup.md). At minimum configure:

```env
INSTAGRAM_APP_ID=from_meta
INSTAGRAM_APP_SECRET=from_secret_store
INSTAGRAM_REDIRECT_URI=https://pinkpaisa.in/api/instagram/admin/connect/callback
INSTAGRAM_TOKEN_ENCRYPTION_KEY=independent_high_entropy_secret
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=independent_high_entropy_verify_token
INSTAGRAM_GRAPH_API_VERSION=v23.0
SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID=expected_professional_account_id
```

The current complete OAuth path is Instagram Login. Do not claim Facebook Login support until its Page-selection/Page-token flow is implemented and reviewed.

## 3. Configure GA4 and Search Console service-account access

Pink Paisa can mint short-lived read-only Google OAuth tokens from a service-account key. Configure the account in Google before setting the environment.

1. Create/select a dedicated Google Cloud project.
2. Enable the **Google Analytics Data API** and **Google Search Console API**.
3. Create a dedicated service account; do not reuse a broad deployment/owner account.
4. In GA4 property access management, add the service-account `client_email` with **Viewer** access to the exact property.
5. In Search Console Settings -> Users and permissions, add the same service-account email with the least permission that can read Search Analytics for the exact property. A Full user has report access; ownership is not required for this read-only workflow.
6. Create a JSON key only if the Lightsail host cannot use a safer managed identity approach. Store it outside the repo, owned by the service user and mode 0600:

   ```bash
   sudo install -d -m 0700 -o ubuntu -g ubuntu /home/ubuntu/pinkpaisa-secrets
   sudo install -m 0600 -o ubuntu -g ubuntu /secure-upload/google-social-reader.json /home/ubuntu/pinkpaisa-secrets/google-social-reader.json
   ```

7. Configure exact property identifiers:

   ```env
   GA4_PROPERTY_ID=123456789
   GOOGLE_SEARCH_CONSOLE_SITE=sc-domain:pinkpaisa.in
   GOOGLE_APPLICATION_CREDENTIALS=/home/ubuntu/pinkpaisa-secrets/google-social-reader.json
   GOOGLE_SERVICE_ACCOUNT_JSON=
   ```

   A URL-prefix Search Console property must instead match exactly, for example `https://pinkpaisa.in/`. Prefer the credential-file path over inline JSON.
8. Reload the API and worker, then use Admin -> Connections -> Check connections. Do not treat the migration's `PENDING`/configured seed as authentication proof. Require a successful live GA4 report and Search Analytics request for `CONNECTED`.

Google references:

- GA4 Data API service-account quickstart: https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
- GA4 access roles: https://support.google.com/analytics/answer/9305587
- Search Console authorization/read-only scope: https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- Search Console property formats/query: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- Search Console users/permissions: https://support.google.com/webmasters/answer/7687615
- Google service-account key security: https://cloud.google.com/iam/docs/best-practices-service-accounts

## 4. Optional n8n configuration

n8n is not required. For the initial rollout, leave `deploy/n8n/*.json` imported but inactive, or do not import them.

If operations approves n8n:

1. Run a maintained n8n deployment behind HTTPS with restricted editor access and reviewed execution-data retention.
2. Provide these values through n8n's environment/external-secret mechanism, never by editing exported JSON:

   ```text
   PINK_PAISA_BASE_URL=https://pinkpaisa.in
   N8N_SOCIAL_WEBHOOK_SECRET=<new independent shared secret>
   N8N_TRIGGER_BEARER_TOKEN=<new secret for the optional n8n prepublication webhook>
   SOCIAL_ALERT_WEBHOOK_URL=<approved HTTPS alert receiver>
   ```

3. Put the same `N8N_SOCIAL_WEBHOOK_SECRET` in Pink Paisa `server/.env`.
4. Import the exports and inspect every expression, URL, schedule, raw body and header. They are intentionally `active: false`.
5. If the n8n security policy blocks `$env` access, map the expressions to n8n external secrets/approved variables before activation. Do not weaken a shared n8n instance merely to make an example import work.
6. Test the version 1 canonical signature against staging. Confirm the legacy envelope, changed method/path/key/body, stale timestamp, wrong secret and missing idempotency key are rejected. Confirm a completed duplicate replays the exact stored response, the same key with a different body is `409`, and an already verified delivery cannot attach to another receipt.
7. Confirm the metric workflow's bounded retry reuses the same body, timestamp, signature and key. A stored success must replay; a retryable server failure may increment the receipt attempt; an active lease may remain `409` until its owner finishes.
8. Choose exactly one schedule owner for the complete weekly-plan/prepublication/metrics trio:
   - **Internal PM2 (default):** keep `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true`; leave all three n8n workflows inactive.
   - **n8n:** set `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=false`, reload the marketing worker with updated environment, verify internal initiation has stopped, then activate all reviewed n8n schedules.
9. Never activate n8n schedules while the internal flag is true, and never set the flag false unless n8n owns all three schedules. Endpoint receipts do not deduplicate the internal scheduler against n8n, and dual ownership can repeat AI work/cost.
10. Activate only after all tests pass. Never stop the marketing worker; with the internal orchestration gate false it still owns durable AI/publication queues, community handling and unrelated scheduler work.

`N8N_SOCIAL_WEBHOOK_URL` is not required for these n8n -> Pink Paisa triggers. It configures the separate Pink Paisa -> n8n event connector. Set it only when that reverse event path, its HTTPS/host allowlist and its producing call sites have been reviewed. The Connections screen currently evaluates the outbound n8n connector, so it may report n8n as not configured when only inbound triggers are in use; verify the signed inbound workflow by its first-party response and Mongo state instead.

See `deploy/n8n/README.md` for signature directions and workflow details. Official n8n export/import guidance: https://docs.n8n.io/workflows/export-import/

## 5. Install and build

Install or update an audited OS-packaged FFmpeg build before application installation, then record the exact version in the release evidence:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
command -v ffmpeg
command -v ffprobe
ffmpeg -hide_banner -version
ffprobe -hide_banner -version
ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'libx264|h264_'
ffmpeg -hide_banner -encoders 2>/dev/null | grep -E '[[:space:]]aac[[:space:]]'
```

Both encoder checks must return a usable encoder. Point `FFMPEG_PATH` and `FFPROBE_PATH` at the exact `command -v` results; do not assume `/usr/bin` on a differently packaged host. Patch/replace FFmpeg through the normal audited host-maintenance process when security updates are released.

Create the licensed-audio library outside the application release and outside the publicly served `server/uploads` tree:

```bash
sudo install -d -o ubuntu -g ubuntu -m 0750 /var/lib/pinkpaisa/social-audio-library
```

Set `SOCIAL_AUDIO_LIBRARY_ROOT` to that exact absolute path. The deployment archive intentionally excludes `server/private` and never packages audio originals. Preserve `/var/lib/pinkpaisa/social-audio-library` across releases, include it in encrypted backups with the MongoDB `socialaudiotracks` metadata collection, and test restore as a pair. Audio previews are served only by the authenticated Social Media Manager stream route with private/no-store headers; do not add the directory to Nginx or `express.static`.

Primary references: [FFmpeg downloads and release verification](https://ffmpeg.org/download.html), [codec/encoder documentation](https://ffmpeg.org/ffmpeg-codecs.html), and [ffprobe documentation](https://ffmpeg.org/ffprobe.html).

Record the licence and build configuration of the exact binary installed. The checksum-verified Gyan Windows essentials build used for local verification is GPLv3 because it includes GPL codecs such as `libx264`; it is a local external executable and is not committed or packaged with Pink Paisa. Production should normally use the host distribution's reviewed FFmpeg package, and any binary redistribution must follow that build's licence obligations.

After placing the reviewed release without overwriting uploads:

```bash
cd /home/ubuntu/pinkpaisa/server
npm ci --omit=dev

cd /home/ubuntu/pinkpaisa/frontend-next
npm ci
npm run build
npm prune --omit=dev
```

Use the committed lock files. If the build fails, do not restart PM2 onto a partially prepared release.

## 6. Migrate MongoDB

Stop the API and worker so settings/index migrations do not race active processing:

```bash
cd /home/ubuntu/pinkpaisa/server
pm2 stop pinkpaisa-server pinkpaisa-marketing-worker
npm run migrate:social-manager
npm run migrate:social-growth
```

Run the foundation migration before the growth-team migration. The growth migration:

- validates that each research source belongs to exactly one daily generation run or weekly plan;
- backfills media/publication roles on legacy Social assets;
- creates/verifies Social Growth indexes;
- creates/verifies the orchestration receipt's unique endpoint/key and global signed-delivery indexes before n8n activation;
- merges settings into the fail-closed version 3 contract;
- disables the legacy automatic daily-generation schedule for the weekly-team default without disabling manual generation;
- seeds redacted connection-health placeholders as `PENDING` or `NOT_CONFIGURED`.

Save the JSON summary from each migration. `SocialOrchestrationReceipt` must appear in `indexes_created_or_verified`. A `PENDING` connection seed means configuration appears present, not that credentials work. If ownership validation or either orchestration unique index fails, stop and investigate; do not edit records ad hoc to force the migration through.

Before continuing to section 7, run the **Mandatory Node and Mongo transaction gate** in section 8. Do not start PM2 merely because migrations can connect to MongoDB; the release requires a writable `rs0` primary and a proven start/write/abort/rollback transaction.

## 7. Start the release

```bash
cd /home/ubuntu/pinkpaisa/server
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 status
pm2 logs pinkpaisa-server --lines 100 --nostream
pm2 logs pinkpaisa-marketing-worker --lines 100 --nostream
```

Expected processes:

- `pinkpaisa-server`
- `pinkpaisa-marketing-worker`
- `pinkpaisa-frontend`

Confirm Nginx still proxies `/` to 3000 and `/api` plus `/uploads` to 5001. Test and reload only after configuration validation:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Health and smoke tests

### Infrastructure

```bash
curl --fail --show-error http://127.0.0.1:5001/api/health
curl --fail --show-error https://pinkpaisa.in/api/health
curl --fail --show-error https://pinkpaisa.in/
```

`/api/health` must return HTTP 200 with `status: "ok"` and `db: "connected"`. HTTP 503/degraded is a failed deployment gate.

### Mandatory Node and Mongo transaction gate

Run this before starting application traffic and again after the release migration. A passing health endpoint is not enough: the Social Manager depends on real MongoDB transaction semantics.

```bash
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major !== 22) { console.error(`Node 22 required; found ${process.versions.node}`); process.exit(1); } console.log(`Node ${process.versions.node}`)'
mongosh "$MONGO_URI" --quiet --eval 'const h=db.adminCommand({hello:1}); if(h.setName!=="rs0"||h.isWritablePrimary!==true){throw new Error(`MongoDB must be writable rs0 PRIMARY: ${EJSON.stringify(h)}`)}; print("MongoDB rs0 PRIMARY")'
mongosh "$MONGO_URI" --quiet <<'MONGOSH'
const marker = `deployment-transaction-smoke-${new ObjectId()}`;
const session = db.getMongo().startSession({ causalConsistency: false });
const transactionDb = session.getDatabase(db.getName());
try {
  session.startTransaction({
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
  });
  transactionDb.getCollection("adminsettings").insertOne({
    _id: marker,
    key: marker,
    deployment_transaction_smoke: true,
    created_at: new Date(),
  });
  session.abortTransaction();
} finally {
  session.endSession();
}
if (db.getCollection("adminsettings").findOne({ _id: marker })) {
  throw new Error("Aborted transaction marker persisted");
}
print("MongoDB transaction start/majority-write/abort/rollback: PASS");
MONGOSH
```

All three commands must exit zero. Stop and roll back the release if Node is not 22, MongoDB is not writable `rs0`, a transaction is rejected, majority write concern fails, abort fails, or the marker remains visible.

Also verify:

- all PM2 processes remain online across multiple scheduler polls;
- scheduler lease/heartbeat has one owner;
- an existing public generated asset still opens over HTTPS;
- disk space, Mongo indexes and backup jobs are healthy;
- no secret or token appears in logs/connection responses.

### Connections

From the admin, run **Check connections** and require truthful results:

- OpenAI text and image access;
- intended Instagram professional account, scopes and encryption status;
- Meta webhook configuration/test event if community is in rollout scope;
- live GA4 and Search Console read-only request;
- n8n only if deliberately configured;
- research adapters.

### Business workflow, publishing disabled

1. Generate/reuse one weekly plan for the expected IST week.
2. Confirm at least eight materially different candidates and no more than the configured maximum selected feed posts.
3. Approve the plan and produce one selected post.
4. Verify AI strategy/copy/compliance/visual stages, provider attempts/models/cost metadata and source provenance.
5. Verify one of the two accepted active-asset contracts:
   - protected exact-overlay: retained OpenAI original plus a separate validated `sharp_svg_overlay` final; or
   - native v2: byte-preserving provider original plus a `sharp_resize_encode_only_v1` normalized original and an `openai_generated_graphic_passthrough` final whose checksum matches the normalized bytes, with `overlay.method=none` and `pixel_overlay_applied=false`.
6. Force or observe one mocked/staging failure path and confirm no completed draft is created from a terminal AI/compliance/image failure.
7. Approve the current revision and confirm publishing readiness remains blocked while the publishing gate is off.

### Controlled external publish

After the above passes, enable the environment and persisted publishing gates while leaving both auto-publish settings false. Publish one approved single-image test draft. HTTP 202 is not success; follow the durable publication to `PUBLISHED` with the real media ID/permalink and confirm the external account manually.

Then test carousel/Reel/Story/community only when the connection capability matrix and App Review permit each operation. Unsupported actions must create a visible/manual outcome, never simulated success.

When testing the app-level `VIDEO_FEED` format, expect the outbound Meta container to use `media_type=REELS` with `share_to_feed=true`; `REEL` uses the same provider transport. Pink Paisa must preserve the distinct internal format in its stored plan/draft/asset/publication evidence. Story media must use `media_type=STORIES` without a feed caption or `share_to_feed`. A separate legacy `VIDEO` container is not part of the supported deployment contract.

## 9. Staged enablement

Recommended order:

1. Connections and read-only research/analytics.
2. Weekly planning with human plan approval.
3. Prepublication AI production with human draft approval.
4. One controlled direct Instagram publish.
5. Scheduled approved publications.
6. Metric refresh and next-week learning.
7. Community ingestion, AI recommendations and human-approved send.
8. Optional n8n triggers.

Do not enable auto-publish, auto-reply, auto-DM or auto-hide-spam as part of the initial release.

## 10. Rollback

### Immediate kill switch

1. Deactivate the n8n workflows.
2. Set these environment values false and reload the API/worker:

   ```env
   SOCIAL_MANAGER_PUBLISHING_ENABLED=false
   SOCIAL_MANAGER_AUTO_PUBLISH=false
   SOCIAL_AUTO_PUBLISH=false
   SOCIAL_WEEKLY_PLANNING_ENABLED=false
   SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false
   SOCIAL_AUTO_REPLY=false
   SOCIAL_AUTO_DM=false
   SOCIAL_AUTO_HIDE_SPAM=false
   ```

3. Disable corresponding persisted publishing/community automation settings in the admin when available.
4. Inspect queued, scheduled, publishing, failed and uncertain publications before any later re-enable.

### Application rollback

- Deploy the last known-good reviewed archive, run its locked installs/build, and `pm2 startOrReload ... --update-env`.
- Preserve `server/uploads`, Social collections, publication checkpoints, audit logs and metric evidence. Do not drop new collections just because older code ignores them.
- If the data/settings migration itself must be reversed, stop writers and restore the verified pre-migration Mongo backup and matching uploads archive as a coordinated point-in-time restore. A partial manual rollback is unsafe.
- After rollback, repeat infrastructure health and confirm no due schedule is unexpectedly eligible.

An `UNCERTAIN` provider publish is never resolved by code rollback. Reconcile it directly with Instagram before permitting another attempt.

## Related production documentation

- [Architecture](pink-paisa-social-growth-architecture.md)
- [Meta/Instagram setup](pink-paisa-meta-instagram-setup.md)
- [Administrator guide](pink-paisa-social-manager-admin-guide.md)
- [Security and incidents](pink-paisa-social-manager-security.md)
- Lightsail baseline: `deploy/lightsail/README.md`
- Backup/restore: `deploy/lightsail/BACKUPS.md`
