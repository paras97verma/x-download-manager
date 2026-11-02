#!/bin/sh
set -eu

# Stop both the current ByteX process name and the legacy binary on upgrades.
for APP_NAME in bytex-download-manager x-download-manager; do
  APP_PATH=$(command -v "$APP_NAME" 2>/dev/null || true)
  [ -n "$APP_PATH" ] || continue
  app_pids() { pgrep -f "(^|/)${APP_NAME}([[:space:]]|$)" 2>/dev/null || true; }

  for pid in $(app_pids); do
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
      for stale_pid in $(app_pids); do
        kill -TERM "$stale_pid" 2>/dev/null || true
      done
    fi
    attempt=0
    while [ -n "$(app_pids)" ] && [ "$attempt" -lt 25 ]; do
      sleep 1
      attempt=$((attempt + 1))
    done
    if [ -n "$(app_pids)" ]; then
      echo "ByteX Download Manager is still running. Quit it and retry the installation." >&2
      exit 1
    fi
  done
done

exit 0
