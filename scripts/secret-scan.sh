#!/usr/bin/env bash
# Gate E/F: secret scan over tracked files and built browser/server assets.
# The Firebase WEB apiKey is public by design and allowlisted; anything else
# key-shaped in the client bundle, or ANY key in the server bundle, fails.
set -u
cd "$(dirname "$0")/.."
FAIL=0

ALLOWED_WEB_KEY="${ALLOWED_FIREBASE_WEB_KEY:-AIzaSyAecOYr8cb6JAlALYCUXditms9v2ufZTQY}"

echo "[1] tracked files: private key material / service accounts"
if git ls-files -z | grep -zv 'scripts/secret-scan.sh' | xargs -0 grep -lE -- '-----BEGIN (RSA |EC )?PRIVATE KEY|"private_key"|"type": *"service_account"' 2>/dev/null; then
  echo "FAIL: private key material tracked in git"; FAIL=1
else
  echo "ok"
fi

echo "[2] tracked files: .env or credential files must not be tracked"
if git ls-files | grep -xE '\.env|\.env\..*' | grep -v '^\.env\.example$'; then
  echo "FAIL: .env file tracked"; FAIL=1
else
  echo "ok"
fi

echo "[3] built browser assets: only the public Firebase web key may appear"
if [ -d dist/assets ]; then
  KEYS=$(grep -rhoE 'AIza[0-9A-Za-z_-]{35}' dist/assets 2>/dev/null | sort -u)
  for k in $KEYS; do
    if [ "$k" != "$ALLOWED_WEB_KEY" ]; then
      echo "FAIL: unexpected Google API key in browser bundle: ${k:0:12}…"; FAIL=1
    fi
  done
  if grep -rq 'GEMINI_API_KEY' dist/assets 2>/dev/null; then
    echo "FAIL: GEMINI_API_KEY referenced in browser bundle"; FAIL=1
  fi
  echo "checked"
else
  echo "SKIP: dist/assets not built"
fi

echo "[4] built server bundle: no inlined key literals"
if [ -f dist/server.cjs ]; then
  if grep -qE 'AIza[0-9A-Za-z_-]{35}' dist/server.cjs; then
    echo "FAIL: key literal inlined in server bundle"; FAIL=1
  else
    echo "ok"
  fi
else
  echo "SKIP: dist/server.cjs not built"
fi

if [ "$FAIL" -eq 0 ]; then echo "SECRET_SCAN=PASS"; else echo "SECRET_SCAN=FAIL"; fi
exit $FAIL
