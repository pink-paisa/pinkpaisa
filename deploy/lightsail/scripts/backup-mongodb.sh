#!/usr/bin/env bash
set -euo pipefail

if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump is required. Install mongodb-database-tools first." >&2
  exit 1
fi

if [ -z "${MONGO_URI:-}" ]; then
  echo "MONGO_URI is required" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/pinkpaisa-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="$BACKUP_DIR/mongodb"
DEST_FILE="$DEST_DIR/pinkpaisa-$TIMESTAMP.archive.gz"

mkdir -p "$DEST_DIR"
mongodump --uri="$MONGO_URI" --archive="$DEST_FILE" --gzip
find "$DEST_DIR" -type f -name '*.archive.gz' -mtime +"$RETENTION_DAYS" -delete

echo "$DEST_FILE"
