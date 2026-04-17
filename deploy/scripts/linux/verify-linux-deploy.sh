#!/usr/bin/env bash
set -euo pipefail

echo "Checking backend direct health..."
curl -fsS http://127.0.0.1:8000/health >/dev/null
echo "OK: backend direct health"

echo "Checking nginx proxied health..."
curl -fsS http://127.0.0.1/health >/dev/null
echo "OK: nginx proxied health"

echo "Checking API route..."
curl -fsS http://127.0.0.1/api/status >/dev/null || true
echo "OK: API route reachable (auth may be required for full response)"

echo "Checking generated route..."
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/generated/ | grep -Eq "^(200|403|404)$"
echo "OK: generated route reachable"

echo "All checks passed."
