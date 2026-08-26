#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/home/ubuntu/pinkpaisa}"
AUDIO_DIR="${SOCIAL_AUDIO_LIBRARY_ROOT:-$APP_ROOT/server/private/social-audio-library}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/pinkpaisa-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="$BACKUP_DIR/social-audio-library"
DEST_FILE="$DEST_DIR/social-audio-library-$TIMESTAMP.tar.gz"

case "$AUDIO_DIR" in
  /*) ;;
  *) echo "SOCIAL_AUDIO_LIBRARY_ROOT must be an absolute path: $AUDIO_DIR" >&2; exit 1 ;;
esac
if [ "$AUDIO_DIR" = "/" ] || [ "$AUDIO_DIR" = "/var" ] || [ "$AUDIO_DIR" = "/home" ]; then
  echo "Refusing to back up an unsafe broad audio path: $AUDIO_DIR" >&2
  exit 1
fi
if [ ! -d "$AUDIO_DIR" ]; then
  echo "Social audio library directory not found: $AUDIO_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
tar -czf "$DEST_FILE" -C "$(dirname "$AUDIO_DIR")" "$(basename "$AUDIO_DIR")"
find "$DEST_DIR" -type f -name 'social-audio-library-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "$DEST_FILE"
