#!/bin/sh
set -eu

APP_NAME=x-download-manager
APP_PATH=$(command -v "$APP_NAME" 2>/dev/null || true)
[ -n "$APP_PATH" ] || exit 0

# Installer/package manager already has administrative authority here. Request
# a clean quit as the logged-in desktop user so its IPC settings are readable.
for pid in $(pgrep -x "$APP_NAME" 2>/dev/null || true); do
  user=$(ps -o user= -p "$pid" | tr -d ' ')
  if [ -n "$user" ] && [ "$user" != root ] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$user" -- "$APP_PATH" --prepare-for-update >/dev/null 2>&1 &
  elif [ -n "$user" ] && [ "$user" != root ] && command -v su >/dev/null 2>&1; then
    su -s /bin/sh "$user" -c "'$APP_PATH' --prepare-for-update" >/dev/null 2>&1 &
  else
    "$APP_PATH" --prepare-for-update >/dev/null 2>&1 &
  fi

  attempt=0
  while kill -0 "$pid" 2>/dev/null && [ "$attempt" -lt 5 ]; do
    sleep 1
    attempt=$((attempt + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    # Older app versions predate the IPC quit request. SIGTERM asks them to exit.
    for stale_pid in $(pgrep -x "$APP_NAME" 2>/dev/null || true); do
      kill -TERM "$stale_pid" 2>/dev/null || true
    done
  fi
  attempt=0
  while pgrep -x "$APP_NAME" >/dev/null 2>&1 && [ "$attempt" -lt 25 ]; do
    sleep 1
    attempt=$((attempt + 1))
  done
  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    echo "ByteX Download Manager is still running. Quit it and retry the installation." >&2
    exit 1
  fi
done

exit 0
