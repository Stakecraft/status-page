#!/usr/bin/env bash
set -euo pipefail

API="${API_BASE_URL:-http://localhost:3333}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Status Page API Tests ==="
echo "Target: $API"
echo

# Health
HEALTH=$(curl -sf "$API/api/health" || echo '{}')
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','missing'))" 2>/dev/null || echo "error")
PROM=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checks',{}).get('prometheus','missing'))" 2>/dev/null || echo "error")
SERVICES=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checks',{}).get('servicesLoaded',0))" 2>/dev/null || echo "0")
check "GET /api/health returns status" "$([ "$STATUS" = "ok" ] || [ "$STATUS" = "degraded" ] && echo ok || echo "got $STATUS")"
check "Prometheus reachable" "$([ "$PROM" = "ok" ] && echo ok || echo "got $PROM")"
check "Services loaded ($SERVICES)" "$([ "$SERVICES" -ge 20 ] && echo ok || echo "only $SERVICES")"

# Config
CONFIG=$(curl -sf "$API/api/v2/config" || echo '{}')
CATS=$(echo "$CONFIG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('categories',[])))" 2>/dev/null || echo "0")
COUNT=$(echo "$CONFIG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('serviceCount',0))" 2>/dev/null || echo "0")
check "GET /api/v2/config categories" "$([ "$CATS" -ge 3 ] && echo ok || echo "got $CATS categories")"
check "GET /api/v2/config service count" "$([ "$COUNT" -ge 20 ] && echo ok || echo "got $COUNT")"

# Batch status
STATUS_RESP=$(curl -sf "$API/api/v2/status" || echo '{}')
OVERALL=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('overall','missing'))" 2>/dev/null || echo "error")
OP=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('operational',0))" 2>/dev/null || echo "0")
OUT=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('outage',0))" 2>/dev/null || echo "0")
UNK=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('unknown',0))" 2>/dev/null || echo "0")
TOTAL=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('services',[])))" 2>/dev/null || echo "0")
check "GET /api/v2/status overall=$OVERALL" "$([ "$OVERALL" != "missing" ] && [ "$OVERALL" != "error" ] && echo ok || echo "invalid")"
check "GET /api/v2/status returns $TOTAL services" "$([ "$TOTAL" -ge 20 ] && echo ok || echo "got $TOTAL")"
echo "    operational=$OP  outage=$OUT  unknown=$UNK"

# Single service history
HIST=$(curl -sf "$API/api/v2/history/solana?range=7d" || echo '{}')
POINTS=$(echo "$HIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('historicalData',[])))" 2>/dev/null || echo "0")
check "GET /api/v2/history/solana?range=7d ($POINTS points)" "$([ "$POINTS" -ge 5 ] && echo ok || echo "got $POINTS points")"

# Batch history
BATCH=$(curl -sf "$API/api/v2/history?range=7d" || echo '{}')
HIST_COUNT=$(echo "$BATCH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('histories',{})))" 2>/dev/null || echo "0")
check "GET /api/v2/history?range=7d ($HIST_COUNT services)" "$([ "$HIST_COUNT" -ge 20 ] && echo ok || echo "got $HIST_COUNT")"

# Legacy v1 (if configured)
V1=$(curl -sf "$API/api/status/solanaNodeStakecraft" || echo '{}')
V1_STATUS=$(echo "$V1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','missing'))" 2>/dev/null || echo "error")
check "GET /api/status/solanaNodeStakecraft (v1 legacy)" "$([ "$V1_STATUS" != "missing" ] && [ "$V1_STATUS" != "error" ] && echo ok || echo "got $V1_STATUS")"

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
