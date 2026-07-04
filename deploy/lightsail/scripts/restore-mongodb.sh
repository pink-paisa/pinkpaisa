#!/usr/bin/env bash
set -euo pipefail

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "mongorestore is required. Install mongodb-database-tools first." >&2
  exit 1
fi

if [ -z "${MONGO_URI:-}" ]; then
  echo "MONGO_URI is required" >&2
  exit 1
fi

ARCHIVE_PATH="${1:-}"
if [ -z "$ARCHIVE_PATH" ] || [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Usage: CONFIRM_RESTORE=yes $0 /path/to/pinkpaisa.archive.gz" >&2
  exit 1
fi

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Set CONFIRM_RESTORE=yes to restore. This will drop existing database data." >&2
  exit 1
fi

mongorestore --uri="$MONGO_URI" --archive="$ARCHIVE_PATH" --gzip --drop
