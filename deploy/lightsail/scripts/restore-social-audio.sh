#!/usr/bin/env bash
set -euo pipefail

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Set CONFIRM_RESTORE=yes to restore the social audio library." >&2
  exit 1
fi
if [ "$#" -ne 1 ]; then
  echo "Usage: CONFIRM_RESTORE=yes $0 /absolute/path/social-audio-library-TIMESTAMP.tar.gz" >&2
  exit 1
fi

APP_ROOT="${APP_ROOT:-/home/ubuntu/pinkpaisa}"
AUDIO_DIR="${SOCIAL_AUDIO_LIBRARY_ROOT:-$APP_ROOT/server/private/social-audio-library}"
ARCHIVE="$1"
case "$AUDIO_DIR" in
  /*) ;;
  *) echo "SOCIAL_AUDIO_LIBRARY_ROOT must be an absolute path: $AUDIO_DIR" >&2; exit 1 ;;
esac
if [ "$AUDIO_DIR" = "/" ] || [ "$AUDIO_DIR" = "/var" ] || [ "$AUDIO_DIR" = "/home" ]; then
  echo "Refusing to restore an unsafe broad audio path: $AUDIO_DIR" >&2
  exit 1
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "Backup archive not found: $ARCHIVE" >&2
  exit 1
fi

EXPECTED_ROOT="$(basename "$AUDIO_DIR")"
while IFS= read -r entry; do
  case "$entry" in
    "$EXPECTED_ROOT"|"$EXPECTED_ROOT/"*) ;;
    *) echo "Archive contains an unexpected path: $entry" >&2; exit 1 ;;
  esac
  case "/$entry/" in
    *"/../"*) echo "Archive contains an unsafe parent traversal: $entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$ARCHIVE")

PARENT_DIR="$(dirname "$AUDIO_DIR")"
mkdir -p "$PARENT_DIR"
if [ -e "$AUDIO_DIR" ]; then
  SAFETY_COPY="${AUDIO_DIR}.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mv -- "$AUDIO_DIR" "$SAFETY_COPY"
  echo "Existing audio library moved to recoverable safety copy: $SAFETY_COPY"
fi
tar -xzf "$ARCHIVE" -C "$PARENT_DIR"

echo "Restored social audio library to: $AUDIO_DIR"
