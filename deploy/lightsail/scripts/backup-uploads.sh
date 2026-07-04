#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/ubuntu/pinkpaisa}"
UPLOADS_DIR="${UPLOADS_DIR:-$APP_ROOT/server/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/pinkpaisa-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="$BACKUP_DIR/uploads"
DEST_FILE="$DEST_DIR/uploads-$TIMESTAMP.tar.gz"

mkdir -p "$DEST_DIR"

if [ ! -d "$UPLOADS_DIR" ]; then
  echo "Uploads directory not found: $UPLOADS_DIR" >&2
  exit 1
fi

tar -czf "$DEST_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
find "$DEST_DIR" -type f -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "$DEST_FILE"
