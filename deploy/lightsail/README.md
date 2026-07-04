# Pink Paisa Lightsail Deployment

This project is easiest to deploy on a single Ubuntu Lightsail instance with:

- `frontend-next/` run as a Next.js server on port `3000`
- `server/server.js` run by PM2 on port `5001`
- Nginx proxying `/` to Next.js and `/api` + `/uploads` to Express

For Instagram publishing to work, use a real domain with HTTPS. Do not keep `localhost` or temporary tunnel URLs in production env files.

## 1. Instance prerequisites

On the Lightsail Ubuntu instance:

```bash
sudo apt update
sudo apt install -y nginx unzip redis-server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Install MongoDB and MongoDB Database Tools using the official MongoDB instructions for your Ubuntu release. The app requires MongoDB for application data and `mongodump`/`mongorestore` for the backup scripts.

Verify:

```bash
node -v
npm -v
pm2 -v
nginx -v
redis-cli ping
mongodump --version
```

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

## 6. Start backend with PM2

```bash
cd /home/ubuntu/pinkpaisa/server
pm2 start ecosystem.config.cjs
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

## 11. Backups

At minimum, enable automatic Lightsail instance snapshots.

For app-level backups, set these env values in `/home/ubuntu/pinkpaisa/server/.env`:

```env
BACKUP_DIR=/home/ubuntu/pinkpaisa-backups
BACKUP_RETENTION_DAYS=14
BACKUP_SCRIPT_PATH=/home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh
```

Then run:

```bash
cd /home/ubuntu/pinkpaisa/server
set -a
. ./.env
set +a
bash /home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh
```

See `deploy/lightsail/BACKUPS.md` for cron and restore commands.
