# Status Page v2 — Grafana-Centric Architecture Proposal

**Branch:** `proposal/status-page-v2-grafana`  
**Status:** Draft for review  
**Date:** 2026-07-01

## Executive Summary

Replace the current fragmented Prometheus-proxy approach with a **Grafana-centric monitoring model** where:

1. **Grafana is the source of truth** for uptime metrics, dashboards, and alerting.
2. A dedicated **internal ops dashboard** shows all public services and nodes in one place.
3. The **public status page** reads standardized metrics through a thin API layer — no more per-service custom PromQL scattered across gitignored YAML.
4. **One config file** drives the status page, Grafana dashboard, and alert rules.

---

## Problems with the Current Approach

| Problem | Impact |
|---------|--------|
| **Triple config drift** | Services defined in `docs/config.js`, hardcoded HTML cards in `index.html`, and gitignored `proxy-services-config.yaml` on the server |
| **No Grafana integration** | Ops team uses Grafana internally; status page queries raw Prometheus with ad-hoc metric names |
| **Inconsistent metric semantics** | Frontend heuristics guess whether values are ratios, percentages, or binary flags |
| **50 sequential API calls** | 25 services × (status + history) on every page load |
| **Binary live status only** | `operational` / `outage` / `unknown` — no `degraded` state despite historical bars supporting it |
| **Unknown ≠ outage** | Page can show "All Systems Operational" while services are `unknown` |
| **No self-monitoring** | Backend has no `/health` endpoint; proxy failures are invisible |

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Monitoring Stack (internal)                       │
│                                                                          │
│  Exporters / Node agents ──► Prometheus ──► Recording Rules             │
│                                    │              │                      │
│                                    └──────┬───────┘                      │
│                                           ▼                              │
│                                    Grafana (internal)                    │
│                                    ┌──────────────────────┐              │
│                                    │ Public Uptime        │              │
│                                    │ Overview Dashboard   │              │
│                                    │ (all services/nodes) │              │
│                                    └──────────────────────┘              │
│                                           │                              │
│                                    Unified Alerting                      │
│                                    (degraded / outage)                   │
└───────────────────────────────────────────┬─────────────────────────────┘
                                            │
                    standardized metrics    │  (stakecraft:service:*)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Status Page Backend (api.status.stakecraft.com)      │
│                                                                          │
│  GET /api/v2/status          ← batch: all services in one call           │
│  GET /api/v2/status/:id    ← single service detail                       │
│  GET /api/v2/history/:id   ← daily uptime bars                           │
│  GET /api/health           ← self-monitoring                             │
│  GET /api/github-incidents ← unchanged                                   │
│                                                                          │
│  Reads: config/services.yaml (single source of truth)                    │
│  Queries: Prometheus via standardized recording rules                    │
│  Optional: Grafana API for annotations / alert state                     │
└───────────────────────────────────────────┬─────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Public Status Page (status.stakecraft.com)                  │
│                                                                          │
│  GitHub Pages — dynamically rendered from config, no hardcoded HTML      │
│  Single batch fetch on load + optional 60s polling                         │
│  Incident history page (GitHub Issues — unchanged)                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Grafana for humans, Prometheus for machines** — Ops uses Grafana dashboards; the status page API queries standardized Prometheus recording rules (same data, no Grafana dependency at runtime).
2. **Convention over configuration** — Every public service exposes the same metric shape; config only names the service and its Prometheus labels.
3. **Single source of truth** — `config/services.yaml` in git drives everything.
4. **Fail visibly** — Unknown/missing data surfaces as degraded, not silently as "operational".

---

## Standardized Metrics

Introduce recording rules that normalize all service health into a consistent schema. See `grafana/recording-rules.yaml` for the full spec.

### Core metrics

| Metric | Type | Description |
|--------|------|-------------|
| `stakecraft:service:up` | gauge (0/1) | Current health: 1 = operational |
| `stakecraft:service:uptime_ratio:1d` | gauge (0–1) | Daily uptime ratio for history bars |
| `stakecraft:service:uptime_ratio:30d` | gauge (0–1) | Rolling 30-day uptime percentage |

### Labels (consistent across all services)

```yaml
service:   solana          # short id, matches config
category:  node            # node | website | indexer | oracle | collator
network:   mainnet         # mainnet | testnet
public:    "true"          # exposed on status page
```

### Example recording rule

```yaml
- record: stakecraft:service:up
  expr: |
    label_replace(
      label_replace(up{job=~"solana-mainnet|walrus-mainnet|..."}, "service", "$1", "job", "(.+)-mainnet"),
      "category", "node", "", ""
    )
```

For services that need custom health logic (e.g. block height lag), compose with existing metrics:

```yaml
- record: stakecraft:service:up
  expr: |
    (block_height_lag{job="solana-mainnet"} < 100)
    and on(job) up{job="solana-mainnet"} == 1
```

---

## Internal Grafana Dashboard

Create a dedicated dashboard: **"Stakecraft — Public Services & Nodes Uptime"**.

### Layout

| Row | Panels |
|-----|--------|
| **Summary** | Stat panels: total services, operational count, degraded, outage; 30d overall uptime |
| **Websites** | Stakecraft.com uptime + response time |
| **Nodes** | Grid of stat panels — one per node, color by `stakecraft:service:up` |
| **History** | Time series: `stakecraft:service:uptime_ratio:1d` per service (sparklines) |
| **Alerts** | Active Grafana alert list for `stakecraft:*` rules |

### Provisioning

Dashboard JSON lives in the repo at `grafana/dashboards/public-uptime-overview.json` and is provisioned via Grafana's dashboard provisioning (ConfigMap, file mount, or Grafana Cloud).

### Access

- **Internal only** — VPN or Grafana auth; not embedded on the public status page.
- Ops team uses this for investigation; public page stays minimal.

---

## Unified Service Config

Replace the triple-config pattern with one file: `config/services.yaml`.

```yaml
version: 2

defaults:
  category: node
  network: mainnet
  public: true
  health:
    type: up                    # up | threshold | composite
    prometheus_job: solana-mainnet

services:
  - id: solana
    name: Solana Mainnet Node
    category: node
    health:
      type: up
      prometheus_job: solana-mainnet

  - id: stakecraft-com
    name: Stakecraft.com
    category: website
    health:
      type: threshold
      query: probe_success{job="blackbox-stakecraft-com"}
      condition: "== 1"

  - id: walrus
    name: Walrus Mainnet Node
    category: node
    health:
      type: composite
      conditions:
        - query: up{job="walrus-mainnet"}
          condition: "== 1"
        - query: walrus_node_healthy{job="walrus-mainnet"}
          condition: "== 1"
```

This file is used by:

- Status page backend (API queries)
- Grafana dashboard variable `$service` (generated or manually synced)
- Alert rule generation (future: script to emit Grafana alert YAML)

See `config/services.yaml.example` for the full 25-service template.

---

## API v2 Design

### Batch status (new — fixes N+1 problem)

```
GET /api/v2/status
```

Response:

```json
{
  "overall": "operational",
  "summary": { "operational": 24, "degraded": 1, "outage": 0, "unknown": 0 },
  "services": [
    {
      "id": "solana",
      "name": "Solana Mainnet Node",
      "category": "node",
      "status": "operational",
      "uptime30d": 99.97,
      "lastChecked": "2026-07-01T12:00:00Z"
    }
  ],
  "lastChecked": "2026-07-01T12:00:00Z"
}
```

### Overall status logic (revised)

| Condition | Overall banner |
|-----------|----------------|
| Any service `outage` | Major Outage |
| Any service `degraded` or `unknown` | Degraded Performance |
| All `operational` | All Systems Operational |

### Status determination

| State | Rule |
|-------|------|
| `operational` | `stakecraft:service:up == 1` |
| `degraded` | Partial failure, elevated latency, or stale metrics (< 5 min old) |
| `outage` | `stakecraft:service:up == 0` for > 2 min (avoid flapping) |
| `unknown` | No data for > 5 min — **counts as degraded** in overall banner |

### History (simplified)

```
GET /api/v2/history/:id?range=7d|15d|30d
```

Uses `stakecraft:service:uptime_ratio:1d` — no frontend heuristics needed. Values are always 0–1 ratios.

---

## Frontend Changes

### Dynamic rendering

Remove hardcoded service cards from `index.html`. The page shell loads; JavaScript renders service rows from the batch API response grouped by category:

```
Websites
  └ Stakecraft.com          ● Operational   99.99%   [==== bars ====]

Nodes
  └ Solana Mainnet Node     ● Operational   99.97%   [==== bars ====]
  └ Walrus Mainnet Node     ● Operational   100%     [==== bars ====]
  ...
```

### Performance

- **1 API call** on load (batch status + embedded 30d uptime)
- **1 API call** per time-range change (batch history)
- Optional **60s polling** for live updates

### Tech choice

Keep vanilla JS for minimal hosting footprint on GitHub Pages, or migrate to a small Vite build if component complexity grows. Recommendation: stay vanilla for v2 unless you want SSR.

---

## Alerting Strategy

Define Grafana alert rules tied to `stakecraft:service:up`:

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| ServiceDown | `up == 0` for 2m | critical | Slack/PagerDuty + auto GitHub issue (optional) |
| ServiceDegraded | composite health partial fail for 5m | warning | Slack |
| MetricsMissing | no data for 10m | warning | Slack (ops) |

Alerts stay in Grafana. The status page reads metric state, not alert state — simpler and avoids coupling to Grafana API at runtime.

Optional future: Grafana annotations on alert fire → incident timeline overlay on status page.

---

## Migration Plan

### Phase 1 — Foundation (1–2 weeks)

- [ ] Add recording rules to Prometheus (`grafana/recording-rules.yaml`)
- [ ] Create `config/services.yaml` from existing gitignored YAML + `config.js`
- [ ] Build internal Grafana dashboard from `grafana/dashboards/public-uptime-overview.json`
- [ ] Validate all 25 services report correctly in Grafana

### Phase 2 — Backend v2 (1 week)

- [ ] Implement `/api/v2/status` batch endpoint
- [ ] Implement `/api/v2/history/:id` using recording rules
- [ ] Add `/api/health` endpoint
- [ ] Run v1 and v2 APIs in parallel during transition

### Phase 3 — Frontend v2 (1 week)

- [ ] Dynamic service rendering from batch API
- [ ] Revised overall status logic (unknown → degraded)
- [ ] Remove hardcoded HTML service cards
- [ ] Add optional auto-refresh

### Phase 4 — Cutover & cleanup (2–3 days)

- [ ] Point frontend to v2 API
- [ ] Remove v1 endpoints and `proxy-services-config.yaml`
- [ ] Remove duplicate `docs/config.js` service list (fetch from API or shared config)
- [ ] Update README and runbook

### Phase 5 — Enhancements (ongoing)

- [ ] Grafana alert → GitHub issue automation
- [ ] RSS/Atom feed from batch API
- [ ] Status page component status (monitor the monitor)
- [ ] Per-service detail pages with Grafana snapshot links (internal)

---

## Environment Variables (v2 additions)

```bash
# Existing
ACTUAL_PROMETHEUS_URL=http://internal-prometheus:9090
GITHUB_TOKEN=...
GITHUB_REPO_OWNER=Stakecraft
GITHUB_REPO_NAME=status-page

# New (optional — for Grafana annotations / admin tooling)
GRAFANA_URL=https://grafana.internal.stakecraft.com
GRAFANA_SERVICE_ACCOUNT_TOKEN=...
GRAFANA_DASHBOARD_UID=public-uptime-overview

# Config
SERVICES_CONFIG_PATH=/usr/src/app/config/services.yaml
API_V2_ENABLED=true
STATUS_POLL_INTERVAL_SECONDS=60
```

---

## What We Keep

- **GitHub Pages** hosting for the public frontend
- **Docker + Nginx** backend deployment
- **GitHub Issues** for incident history and reporting template
- **Prometheus** as the metrics store (Grafana queries the same data)

## What We Remove

- Gitignored `proxy-services-config.yaml` (replaced by `config/services.yaml` in git)
- Hardcoded service HTML in `index.html`
- Duplicate service list in `docs/config.js`
- Per-service PromQL in backend code
- Frontend metric-value heuristics

---

## Open Questions

1. **Grafana hosting** — Self-hosted vs Grafana Cloud? (Affects dashboard provisioning method.)
2. **Custom health per node** — Which nodes need composite health (block lag, peer count) vs simple `up`?
3. **Public vs internal services** — Should the internal dashboard show non-public infra too?
4. **Incident automation** — Auto-create GitHub issues from Grafana alerts, or keep manual?
5. **Degraded definition** — Block lag thresholds per chain? Response time SLOs for websites?

---

## Decision Requested

Review this proposal and confirm:

1. Grafana dashboard as internal ops view + standardized Prometheus metrics for the public API — acceptable split?
2. Single `config/services.yaml` in git as source of truth — OK to retire gitignored YAML?
3. Revised overall status logic (unknown counts as degraded) — desired behavior?
4. Phase ordering and timeline — any constraints?

Once approved, implementation can proceed on this branch or a new `feat/status-page-v2` branch.
