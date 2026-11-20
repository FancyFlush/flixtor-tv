#!/usr/bin/env bash
#
# Install the newest GitHub release of FlixTor TV onto a TV over adb.
#
# Works with a PRIVATE repository: downloads go through the GitHub CLI (`gh`),
# so run `gh auth login` once first.
#
# Usage:
#   ./tools/install_tv.sh 192.168.1.50:5555            # upgrade in place
#   ./tools/install_tv.sh 192.168.1.50:5555 --reinstall # uninstall first (WIPES app data)
#
# Use --reinstall only when a normal install fails with a signature mismatch.
set -euo pipefail

REPO="FancyFlush/flixtor-tv"
PACKAGE="dev.personal.flixtortv"

TV_HOST="${1:-${TV_HOST:-}}"
REINSTALL="no"
[[ "${2:-}" == "--reinstall" ]] && REINSTALL="yes"
ADB="${ADB:-$(command -v adb || true)}"

if [[ -z "$TV_HOST" ]]; then
  echo "error: pass the TV address, e.g. ./tools/install_tv.sh 192.168.1.50:5555" >&2
  exit 1
fi
if [[ -z "$ADB" || ! -x "$ADB" ]]; then
  echo "error: adb not found. Install Android platform-tools or set ADB=/path/to/adb" >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI (gh) is required. Install it and run: gh auth login" >&2
  exit 1
fi

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> Downloading newest release of ${REPO} ..."
TAG="$(gh release view -R "$REPO" --json tagName -q .tagName)"
gh release download "$TAG" -R "$REPO" -p flixtor.apk -p release.json -D "$TMP_DIR"
APK="${TMP_DIR}/flixtor.apk"
RELEASE_JSON="${TMP_DIR}/release.json"
echo "==> Release: ${TAG}"

EXPECTED_SHA="$(grep -m1 -o '"sha256": *"[^"]*"' "$RELEASE_JSON" | sed -E 's/.*"sha256": *"([^"]*)"/\1/')"
if [[ -z "$EXPECTED_SHA" ]]; then
  echo "error: release.json has no sha256 field" >&2
  exit 1
fi
ACTUAL="$(sha256_of "$APK")"
if [[ "$ACTUAL" != "$EXPECTED_SHA" ]]; then
  echo "error: sha256 mismatch: expected ${EXPECTED_SHA} got ${ACTUAL}" >&2
  exit 1
fi
echo "==> sha256 OK"

echo "==> Connecting to TV ${TV_HOST} ..."
"$ADB" connect "$TV_HOST" >/dev/null 2>&1 || true
if ! "$ADB" -s "$TV_HOST" get-state >/dev/null 2>&1; then
  echo "error: TV ${TV_HOST} is not reachable via adb. Is it on the network with debugging enabled?" >&2
  exit 1
fi

if [[ "$REINSTALL" == "yes" ]]; then
  echo "==> Uninstalling ${PACKAGE} (app data will be lost) ..."
  "$ADB" -s "$TV_HOST" uninstall "$PACKAGE" >/dev/null 2>&1 && echo "    old app removed" || echo "    no previous install (continuing)"
fi

echo "==> Installing ${TAG} ..."
if ! OUTPUT="$("$ADB" -s "$TV_HOST" install -r "$APK" 2>&1)"; then
  echo "$OUTPUT" >&2
  echo "error: adb install failed. If the message mentions a signature mismatch, re-run with --reinstall." >&2
  exit 1
fi
echo "    installed"

echo "==> Installed version:"
"$ADB" -s "$TV_HOST" shell dumpsys package "$PACKAGE" 2>/dev/null | grep -E "versionCode|versionName" || true
echo "==> Done: ${TAG} installed on ${TV_HOST}"
