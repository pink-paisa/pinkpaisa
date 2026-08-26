# Pink Paisa Lightsail Deployment

This project is easiest to deploy on a single Ubuntu Lightsail instance with:

- `frontend-next/` run as a Next.js server on port `3000`
- `server/server.js` run by PM2 on port `5001`
- `server/workers/marketingWorker.js` run as a separate PM2 process
- Nginx proxying `/` to Next.js and `/api` + `/uploads` to Express

For Instagram publishing to work, use a real domain with HTTPS. Do not keep `localhost` or temporary tunnel URLs in production env files.

## 1. Instance prerequisites

On the Lightsail Ubuntu instance:

```bash
sudo apt update
sudo apt install -y nginx unzip redis-server ffmpeg
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Install MongoDB and MongoDB Database Tools using the official MongoDB instructions for your Ubuntu release. The app requires MongoDB for application data and `mongodump`/`mongorestore` for the backup scripts. Social Manager approval, scheduling, safe edits and durable community sends require transactions, so production MongoDB must run as a writable replica set named `rs0`; standalone MongoDB is unsupported.

For an existing standalone host, first take and verify a MongoDB backup, stop Pink Paisa writers, add `replication.replSetName: rs0` to the reviewed `/etc/mongod.conf`, restart `mongod`, initialize the single-node set once with the exact stable local member address, and wait for `PRIMARY`. Never run `rs.initiate()` against an already configured replica set. Confirm the actual state before and after every step:

```bash
mongosh --quiet --eval 'db.adminCommand({ hello: 1 })'
mongosh --quiet --eval 'rs.status()'
```

The production URI must identify the replica set and quote shell metacharacters:

```env
MONGO_URI="mongodb://127.0.0.1:27017/pinkpaisa?replicaSet=rs0&retryWrites=true&w=majority"
```

Verify:

```bash
node -v
npm -v
pm2 -v
nginx -v
redis-cli ping
mongodump --version
command -v ffmpeg
command -v ffprobe
ffmpeg -hide_banner -version
ffprobe -hide_banner -version
ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'libx264|h264_'
ffmpeg -hide_banner -encoders 2>/dev/null | grep -E '[[:space:]]aac[[:space:]]'
```

`node -v` must report major version 22. `rs.status()` must report `set: "rs0"`, and `db.adminCommand({ hello: 1 })` must report a writable primary before dependencies, migrations or PM2 processes are started.

Both encoder checks must return a usable H.264 video encoder and AAC audio encoder. Record the exact audited package version, and set `FFMPEG_PATH` and `FFPROBE_PATH` to the paths returned by `command -v`; do not assume `/usr/bin` on every host.

## 2. Copy project to the server

From your local machine, copy the repo from this project root:

```bash
scp -r . ubuntu@YOUR_SERVER_IP:/home/ubuntu/pinkpaisa
```

Or zip the repo locally and upload/extract it on the instance.

## 3. Backend env

Create `/home/ubuntu/pinkpaisa/server/.env` from `deploy/lightsail/server.env.production.example`.

Important:

- `SERVER_URL` must be your public HTTPS domain
- `PUBLIC_MEDIA_BASE_URL` should usually match `SERVER_URL`
- `FRONTEND_URL` must be your public frontend URL
- `INSTAGRAM_REDIRECT_URI` must match Meta exactly
- keep `MARKETING_WORKER_IN_API=false` and `MARKETING_SCHEDULER_IN_API=false` in production
- keep `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true` while the PM2 worker owns weekly-plan, prepublication and metrics schedules; keep the n8n schedules inactive
- set `FFMPEG_PATH` and `FFPROBE_PATH` to the verified production binaries and keep `SOCIAL_AUDIO_LIBRARY_ROOT` outside the release and public uploads trees
- keep `AMAZON_CREATORS_API_ENABLED=false` until Pink Paisa receives Creators API access
- keep `MARKETING_AFFILIATE_CAROUSEL_ENABLED=false` during the initial deploy
- set `OPENAI_IMAGE_MODEL=gpt-image-2` and `OPENAI_CAPTION_MODEL=gpt-5.6-luna` unless a reviewed replacement is selected
- every queued campaign product must have a reachable JPEG, PNG, or WebP reference image
- rotate any secrets that were exposed during local testing

## 4. Frontend env

Create `/home/ubuntu/pinkpaisa/frontend-next/.env` from `frontend-next/.env.example`.

Recommended:

```env
NEXT_PUBLIC_API_URL=/api
```

That keeps frontend and backend on the same domain through Nginx.

## 5. Install dependencies and build

```bash
cd /home/ubuntu/pinkpaisa/server
npm ci --omit=dev

cd /home/ubuntu/pinkpaisa/frontend-next
npm ci
npm run build
npm prune --omit=dev
```

Preview and then apply the affiliate-only missing-price migration. It never updates normal checkout products:

```bash
cd /home/ubuntu/pinkpaisa/server
npm run migrate:affiliate-prices
APPLY=true npm run migrate:affiliate-prices
```

## 6. Start backend with PM2

```bash
cd /home/ubuntu/pinkpaisa/server
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

Then follow the printed `pm2 startup` command once.

## 7. Nginx config

Copy `deploy/lightsail/nginx/pinkpaisa.conf` to:

```bash
sudo cp /home/ubuntu/pinkpaisa/deploy/lightsail/nginx/pinkpaisa.conf /etc/nginx/sites-available/pinkpaisa
sudo ln -s /etc/nginx/sites-available/pinkpaisa /etc/nginx/sites-enabled/pinkpaisa
sudo rm -f /etc/nginx/sites-enabled/default
```

Edit these values in the config first:

- `server_name your-domain.com www.your-domain.com`
- repo path if your deploy root differs

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS

Point your domain DNS to the Lightsail instance, then install SSL:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 9. Meta / Instagram settings after deploy

Update Meta to use the production callback:

```text
https://your-domain.com/api/instagram/admin/connect/callback
```

Then update backend env:

- `SERVER_URL=https://your-domain.com`
- `PUBLIC_MEDIA_BASE_URL=https://your-domain.com`
- `FRONTEND_URL=https://your-domain.com`
- `INSTAGRAM_REDIRECT_URI=https://your-domain.com/api/instagram/admin/connect/callback`

## 10. Verify

Check backend:

```bash
curl http://127.0.0.1:5001/api/health
```

Check Next frontend:

- `https://your-domain.com`

Check public media:

- `https://your-domain.com/uploads/generated/campaigns/...jpg`

If the image opens publicly over HTTPS, Instagram publishing can fetch it.

Before enabling the version 3 weekly schedule, generate or reuse one weekly plan for the expected Asia/Kolkata week. Confirm it evaluates at least the configured candidate count, selects no more than three feed posts, produces only approved-plan drafts, and stops each completed creative at `NEEDS_REVIEW`. The automatic weekly model never bypasses plan or draft approval. Keep legacy daily automatic generation disabled so it cannot create a parallel content stream; manual Studio generation remains available.

After the API and marketing worker are healthy, approve two affiliate campaigns with public HTTPS creatives. Set `MARKETING_AFFILIATE_CAROUSEL_ENABLED=true`, run `pm2 startOrReload ecosystem.config.cjs --update-env`, and publish one controlled two-slide carousel. Verify slide order, the shared permalink, compact `/api/c/:campaignId` links, and the same Instagram media ID on both campaign runs before wider use.

Campaign assets are stored on the Lightsail disk under `server/uploads/generated/campaigns`. Releases must preserve `server/uploads`; the deployment package intentionally excludes that directory from replacement.

## 11. Backups

The no-object-storage baseline keeps compressed upload and MongoDB backups on the Lightsail disk. This avoids a separate storage service, but it does not protect against complete instance or disk loss. Lightsail snapshots are optional when the budget permits and are the recommended off-instance recovery layer.

For app-level backups, set these env values in `/home/ubuntu/pinkpaisa/server/.env`:

```env
BACKUP_DIR=/home/ubuntu/pinkpaisa-backups
BACKUP_RETENTION_DAYS=14
BACKUP_SCRIPT_PATH=/home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh
SOCIAL_AUDIO_LIBRARY_ROOT=/var/lib/pinkpaisa/social-audio-library
```

The backup includes generated campaign assets and the separate private, rights-sensitive social audio library. Keep the audio path outside public uploads, preserve its matching MongoDB records, keep the backup cron enabled, and retain Lightsail snapshots.

Then run:

```bash
cd /home/ubuntu/pinkpaisa/server
set -a
. ./.env
set +a
bash /home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh
```

See `deploy/lightsail/BACKUPS.md` for cron and restore commands.

## 12. Fully AI Social Media Manager deployment gate

The Social Media Manager uses the existing Express API, MongoDB, local generated-asset storage, OpenAI text and image APIs, and `pinkpaisa-marketing-worker`. Keep publication draft-only while validating full-AI generation:

```env
OPENAI_SOCIAL_TEXT_MODEL=gpt-5.6-luna
OPENAI_SOCIAL_RESEARCH_MODEL=gpt-5.6-luna
OPENAI_SOCIAL_COMPLIANCE_MODEL=gpt-5.6-luna
OPENAI_SOCIAL_IMAGE_MODEL=gpt-image-2
SOCIAL_AI_FULL_GENERATION=true
SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK=false
SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK=false
SOCIAL_MAX_CONTENT_REVISIONS=3
SOCIAL_MAX_IMAGE_RETRIES=3
SOCIAL_REQUIRE_HUMAN_APPROVAL=true
SOCIAL_DEFAULT_VISUAL_MODE=FULL_AI_GRAPHIC
SOCIAL_MANAGER_ENABLED=true
SOCIAL_TIMEZONE=Asia/Kolkata
SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false
SOCIAL_WEEKLY_PLANNING_ENABLED=true
SOCIAL_WEEKLY_CANDIDATE_COUNT=8
SOCIAL_MAX_FEED_POSTS_PER_WEEK=3
SOCIAL_WEEKLY_PLANNING_WEEKDAY=SUNDAY
SOCIAL_WEEKLY_PLANNING_HOUR_IST=18
SOCIAL_WEEKLY_PLANNING_MINUTE_IST=0
SOCIAL_PREPUBLICATION_LEAD_HOURS=24
SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true
SOCIAL_MANAGER_WEB_SEARCH_ENABLED=false
SOCIAL_MANAGER_PUBLISHING_ENABLED=false
SOCIAL_MANAGER_AUTO_PUBLISH=false
SOCIAL_MANAGER_PUBLICATION_LEASE_MS=300000
SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION=0
SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION=0
```

The two token-rate values are USD per million tokens and deliberately default to zero. Set reviewed current rates for the deployed OpenAI models if the in-app monthly INR threshold will be used, and review `SOCIAL_MANAGER_INR_PER_USD`; zero or stale rates understate spend, so retain provider-side budgets and alerts.

The foundation migration preserves an already recognized persisted visual default. On an existing deployment, setting `SOCIAL_DEFAULT_VISUAL_MODE=FULL_AI_GRAPHIC` does not silently overwrite an administrator-saved exact-overlay default. During the controlled release, verify `GET /api/social-media-manager/admin/settings` as an authenticated administrator and deliberately save **AI-native complete graphic — Recommended, no overlay** if that is not already the persisted value. Stories and authentic product/affiliate creatives still resolve visibly to the protected exact-overlay contract.

Version 3 uses the approved weekly plan as its only automatic content-production stream. The PM2 marketing worker is the default and sole schedule owner while `SOCIAL_INTERNAL_ORCHESTRATION_SCHEDULER_ENABLED=true`; leave all three n8n schedule exports inactive. To transfer schedule ownership to n8n, first set the flag false, reload the worker and verify internal initiation has stopped. The worker must remain online for durable generation/publication queues and unrelated jobs.

After backing up MongoDB and `server/uploads`, stop the API and marketing worker, install the locked dependencies, run the foundation migration followed by the growth-team migration, and verify a real Reel can be assembled with the configured FFmpeg runtime before restarting the processes:

```bash
cd /home/ubuntu/pinkpaisa/server
pm2 stop pinkpaisa-server pinkpaisa-marketing-worker
npm ci --omit=dev
npm run migrate:social-manager
npm run migrate:social-growth
npm run verify:social-reel-runtime
```

Now run the release transaction smoke gate documented in `docs/pink-paisa-social-manager-deployment.md`. Stop the release if the session cannot start a transaction, use majority write concern, abort it and prove the marker did not persist. A healthy TCP connection to standalone MongoDB is not sufficient. Only after that gate passes:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Run the migrations in that order. The foundation migration verifies the version 2 indexes and prompt provenance, merges known settings into the fail-closed full-AI contract, and labels earlier deterministic/template assets as legacy without deleting history. The growth migration validates research ownership, backfills Social asset roles, verifies the version 3 growth, OAuth and orchestration indexes, merges weekly-team defaults, disables legacy daily automatic generation, and seeds redacted connection-health placeholders. Save both JSON summaries; stop the release if either migration or the Reel runtime verifier fails.

The dedicated marketing worker claims generation leases, processes bounded content and image retries, owns queued/scheduled Instagram publications, and—when the internal-owner flag is true—queues the weekly plan, prepublication and metric runs. Keep `MARKETING_WORKER_IN_API=false` and `MARKETING_SCHEDULER_IN_API=false` so PM2 has one designated worker/scheduler owner. The scheduler also has a heartbeated Mongo lease and in-process single-flight guard.

Missing OpenAI access, invalid structured output, exhausted compliance revision, or exhausted image generation must remain a visible failed run. They must never become deterministic evergreen copy or a template-only completed creative. Before entering `NEEDS_REVIEW`, a successful controlled draft must satisfy one truthful asset contract: either the retained OpenAI original plus a separate validated exact-overlay final, or a native-v2 byte-preserving provider original plus resize/encode-only normalized original and checksum-identical passthrough final with no post-generation pixel overlay.

Explicit `SOCIAL_MANAGER_ENABLED=false`, `SOCIAL_WEEKLY_PLANNING_ENABLED=false`, and `SOCIAL_MANAGER_DAILY_GENERATION_ENABLED=false` are one-way deployment kill switches: they override persisted true values after restart. Environment true only permits a feature and does not override a persisted false setting. Instagram publishing separately requires both its environment flag and persisted `publishing.enabled=true` / `provider=INSTAGRAM_GRAPH`; auto-publish also requires both auto flags.

Before enabling direct Instagram publishing, confirm all of the following:

- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, exact `INSTAGRAM_REDIRECT_URI`, and a strong `INSTAGRAM_TOKEN_ENCRYPTION_KEY` are configured.
- The intended Instagram professional account is connected, its token is encrypted and unexpired, and it granted `instagram_business_content_publish` or `instagram_content_publish`.
- `SOCIAL_MANAGER_INSTAGRAM_ACCOUNT_ID` pins the intended account where possible.
- `PUBLIC_MEDIA_BASE_URL` serves every generated asset over public HTTPS.
- A controlled draft passed compliance, satisfies either the protected exact-overlay provenance contract or the native-v2 no-overlay passthrough contract, passed current-revision approval, and passed the per-draft publishing-readiness endpoint.
- Any affiliate draft retains the exact verified catalog product ID/title and canonical `/product/<slug>` route, and that product remains active, visible, unarchived, affiliate-enabled, compliant, backed by a nonempty affiliate URL, and rights-cleared.
- The complete Instagram caption—affiliate disclosure first, then caption, CTA, financial disclaimer, and hashtags—is nonempty and no longer than 2,200 characters.
- Both the environment flag and persisted `publishing.enabled=true` / `provider=INSTAGRAM_GRAPH` setting have been enabled deliberately. Leave `auto_publish=false` for the controlled rollout.

A due `SCHEDULED` draft is explicit publish intent and is processed when the master publishing gate is enabled; the separate `auto_publish` preference is not an additional schedule gate. There is no simulated Instagram success.

**Publish now** returns HTTP 202 after persisting a durable `QUEUED` intent. Follow the publication and worker logs until `PUBLISHED` with a real media ID/permalink; `QUEUED`, `FAILED`, or `UNCERTAIN` is not success. The default `publishing.retry_limit=3` means three retries after the initial attempt, four total attempts.

Publication workers claim intents atomically with a five-minute lease by default. A stale `VALIDATING` or `CONTAINER_CREATED` attempt is safely requeued from its provider checkpoint. A stale `PUBLISHING` attempt has crossed the pre-media-publish checkpoint, becomes `UNCERTAIN`, and is never auto-retried; inspect Instagram and reconcile manually. If a real media ID was checkpointed before the draft save, the worker reconciles the draft to `PUBLISHED` without another provider call.

For immediate rollback, set both publishing environment flags false, reload the API and worker, and disable persisted publishing settings. Before any later re-enable, review overdue `SCHEDULED` drafts, queued intents, retriable failures, and uncertain outcomes. Preserve Social collections, audit records, publication checkpoints, metrics, and generated assets.

Current version 3 instructions:

- [Architecture and schedule ownership](../../docs/pink-paisa-social-growth-architecture.md)
- [Deployment, migrations, FFmpeg, recovery, and rollback](../../docs/pink-paisa-social-manager-deployment.md)
- [Meta/Instagram setup](../../docs/pink-paisa-meta-instagram-setup.md)
- [Administrator workflow](../../docs/pink-paisa-social-manager-admin-guide.md)
- [Security and incident response](../../docs/pink-paisa-social-manager-security.md)
- [Historical version 2 full-AI correction and foundation-migration contract](../../docs/fully-ai-social-manager-correction-plan.md)
