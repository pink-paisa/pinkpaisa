# Lightsail Backups

This project keeps local backups on the Lightsail instance by default. This is better than no backup, but it is not a full disaster-recovery plan because the backup lives on the same server.

Minimum setup:

1. Enable automatic Lightsail instance snapshots in AWS.
2. Install MongoDB database tools on the instance so `mongodump` and `mongorestore` are available.
3. Set these values in `/home/ubuntu/pinkpaisa/server/.env`:

```env
BACKUP_DIR=/home/ubuntu/pinkpaisa-backups
BACKUP_RETENTION_DAYS=14
BACKUP_SCRIPT_PATH=/home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh
SOCIAL_AUDIO_LIBRARY_ROOT=/var/lib/pinkpaisa/social-audio-library
```

Manual backup:

```bash
cd /home/ubuntu/pinkpaisa/server
set -a
. ./.env
set +a
bash /home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh
```

Cron example:

```bash
crontab -e
```

```cron
15 2 * * * cd /home/ubuntu/pinkpaisa/server && set -a && . ./.env && set +a && bash /home/ubuntu/pinkpaisa/deploy/lightsail/scripts/backup-all.sh >> /home/ubuntu/pinkpaisa-backups/backup.log 2>&1
```

Restore MongoDB from a backup:

```bash
cd /home/ubuntu/pinkpaisa/server
set -a
. ./.env
set +a
CONFIRM_RESTORE=yes bash /home/ubuntu/pinkpaisa/deploy/lightsail/scripts/restore-mongodb.sh /home/ubuntu/pinkpaisa-backups/mongodb/pinkpaisa-YYYYMMDDTHHMMSSZ.archive.gz
```

`backup-all.sh` also archives `server/uploads` and the private licensed-audio library. Treat the audio archive as rights-sensitive: keep it private, preserve the matching MongoDB `SocialAudioTrack` records, and never copy it into the public uploads tree.

Restore the private social audio library only after stopping the marketing worker and API. The restore moves any existing library to a timestamped recoverable safety copy before extraction:

```bash
cd /home/ubuntu/pinkpaisa/server
set -a
. ./.env
set +a
pm2 stop pinkpaisa-server pinkpaisa-marketing-worker
CONFIRM_RESTORE=yes bash /home/ubuntu/pinkpaisa/deploy/lightsail/scripts/restore-social-audio.sh /home/ubuntu/pinkpaisa-backups/social-audio-library/social-audio-library-YYYYMMDDTHHMMSSZ.tar.gz
pm2 startOrReload ecosystem.config.cjs --update-env
```

After restore, open the Social Media Manager audio library and verify the file checksum, FFprobe metadata, rights status and preview for at least one active track before rebuilding a Reel.

For production, periodically copy `/home/ubuntu/pinkpaisa-backups` off the instance using your chosen remote storage or manual download.
