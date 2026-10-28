#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_EXT_DIR="${ROOT_DIR}/dist-extensions"
mkdir -p "${DIST_EXT_DIR}"

echo "==> Packaging Chromium Extension (Chrome, Edge, Brave, Opera, Vivaldi)..."
(cd "${ROOT_DIR}/extensions/chromium" && zip -r -q "${DIST_EXT_DIR}/xdm-extension-chromium.zip" .)

echo "==> Packaging Firefox Extension (.xpi & .zip)..."
(cd "${ROOT_DIR}/extensions/firefox" && zip -r -q "${DIST_EXT_DIR}/xdm-extension-firefox.xpi" .)
cp "${DIST_EXT_DIR}/xdm-extension-firefox.xpi" "${DIST_EXT_DIR}/xdm-extension-firefox.zip"

echo "==> Packaging Safari WebExtension + macOS Xcode Wrapper..."
(cd "${ROOT_DIR}/extensions/safari" && zip -r -q "${DIST_EXT_DIR}/xdm-extension-safari.zip" .)

echo "==> All browser extensions packaged in ${DIST_EXT_DIR}:"
ls -lh "${DIST_EXT_DIR}"
