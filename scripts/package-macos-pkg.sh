#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_PKG_DIR="${ROOT_DIR}/dist-pkg"
mkdir -p "${DIST_PKG_DIR}"

# 1. Determine Version
RAW_VERSION="${1:-}"
if [[ -z "${RAW_VERSION}" ]]; then
  if [[ -f "${ROOT_DIR}/package.json" ]]; then
    RAW_VERSION="$(node -p "require('${ROOT_DIR}/package.json').version" 2>/dev/null || echo "1.0.0")"
  else
    RAW_VERSION="1.0.0"
  fi
fi
# Strip leading 'v' if present (e.g. v1.0.1 -> 1.0.1)
VERSION="${RAW_VERSION#v}"

# 2. Locate built macOS .app bundle
APP_PATH=""
SEARCH_PATHS=(
  "${ROOT_DIR}/src-tauri/target/universal-apple-darwin/release/bundle/macos/X Download Manager.app"
  "${ROOT_DIR}/src-tauri/target/release/bundle/macos/X Download Manager.app"
  "${ROOT_DIR}/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/X Download Manager.app"
  "${ROOT_DIR}/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/X Download Manager.app"
)

for p in "${SEARCH_PATHS[@]}"; do
  if [[ -d "${p}" ]]; then
    APP_PATH="${p}"
    break
  fi
done

if [[ -z "${APP_PATH}" ]]; then
  # Fallback to search in target directory
  FOUND_PATH="$(find "${ROOT_DIR}/src-tauri/target" -maxdepth 6 -type d -name "X Download Manager.app" 2>/dev/null | head -n 1 || true)"
  if [[ -n "${FOUND_PATH}" && -d "${FOUND_PATH}" ]]; then
    APP_PATH="${FOUND_PATH}"
  fi
fi

if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
  echo "Error: Could not locate 'X Download Manager.app' bundle in src-tauri/target/." >&2
  echo "Ensure 'cargo tauri build' has completed before running this script." >&2
  exit 1
fi

# 3. Detect architecture
ARCH="universal"
if [[ "${APP_PATH}" == *"aarch64"* ]]; then
  ARCH="aarch64"
elif [[ "${APP_PATH}" == *"x86_64"* ]]; then
  ARCH="x64"
fi

PKG_FILENAME="X-Download-Manager_${VERSION}_${ARCH}.pkg"
PKG_OUTPUT_PATH="${DIST_PKG_DIR}/${PKG_FILENAME}"

echo "==> Building macOS Installer Package (.pkg)..."
echo "    Source Bundle:    ${APP_PATH}"
echo "    App Version:      ${VERSION}"
echo "    Architecture:     ${ARCH}"
echo "    Target Output:    ${PKG_OUTPUT_PATH}"
echo "    Install Location: /Applications"

# 4. Invoke Apple pkgbuild
pkgbuild \
  --component "${APP_PATH}" \
  --install-location "/Applications" \
  --identifier "com.peivee.xdm" \
  --version "${VERSION}" \
  "${PKG_OUTPUT_PATH}"

# Create secondary file without hyphen if needed for compatibility
cp "${PKG_OUTPUT_PATH}" "${DIST_PKG_DIR}/X_Download_Manager_${VERSION}_${ARCH}.pkg"

echo "==> macOS .pkg installer created successfully!"
ls -lh "${DIST_PKG_DIR}"
