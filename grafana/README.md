# Grafana assets (external instance)

Grafana runs separately from this project. The public status page talks to **Prometheus only** via the API.

These files are optional exports you can use on your own Grafana instance:

| File | Purpose |
|------|---------|
| `dashboards/public-uptime-overview.json` | Ops dashboard — import via **Dashboards → Import** |
| `recording-rules.yaml` | Prometheus recording rules for `stakecraft:service:*` metrics |

## Import dashboard

1. Open your Grafana instance (e.g. 8.4.x)
2. **Dashboards → Import → Upload JSON**
3. Select `dashboards/public-uptime-overview.json`
4. Map the Prometheus datasource when prompted

## Recording rules (optional)

Apply `recording-rules.yaml` to Prometheus, then set in `backend/.env`:

```bash
USE_RECORDING_RULES=true
```

Without recording rules, the status page still works via direct PromQL in `config/services.yaml`. The ops dashboard expects the `stakecraft:*` metrics unless you edit its panels.
