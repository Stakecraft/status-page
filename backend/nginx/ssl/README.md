# TLS certificates for `api.status.stakecraft.com`

Place these files here (not committed to git):

| File | Purpose |
|------|---------|
| `fullchain.pem` | Certificate chain |
| `privkey.pem` | Private key |

## Option A: Cloudflare Origin Certificate (recommended if proxied through Cloudflare)

1. Cloudflare dashboard → **SSL/TLS** → **Origin Server** → create certificate for `api.status.stakecraft.com`
2. Save the origin certificate as `fullchain.pem` and the private key as `privkey.pem`
3. Set SSL mode to **Full (strict)** for the API subdomain

## Option B: Let's Encrypt (Certbot)

With the stack running and port 80 reachable:

```bash
docker run -it --rm \
  -v status-page_certbot-webroot:/var/www/certbot \
  -v "$(pwd)/backend/nginx/ssl:/etc/letsencrypt" \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot \
  -d api.status.stakecraft.com \
  --email you@example.com --agree-tos

# Symlink or copy into this directory:
# fullchain.pem ← live/api.status.stakecraft.com/fullchain.pem
# privkey.pem   ← live/api.status.stakecraft.com/privkey.pem
```

Adjust volume names to match your Docker Compose project prefix (`docker volume ls`).

## Option C: Self-signed (local testing only)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout privkey.pem -out fullchain.pem \
  -subj "/CN=api.status.stakecraft.com"
```
