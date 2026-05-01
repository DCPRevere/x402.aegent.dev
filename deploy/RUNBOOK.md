# Deploy runbook — x402.aegent.dev

Reference deployment to a Linux host running Docker and the Caddy reverse
proxy. Container binds `127.0.0.1:34000`; Caddy terminates TLS on 443 and
proxies through. CI builds the image on push to `master`, pushes to GHCR,
and SSHes to the host to redeploy.

One-time setup — once it's working the only thing that runs on master is
the GitHub Actions workflow.

In the steps below, `$HOST` is whatever resolves to your server (DNS
name or IP), and `$SSH_USER` is the account you SSH in as. Set them in
your shell or substitute as you go.

## Prerequisites

- A domain you control in Cloudflare (DNS only — proxy off, see Step 4).
- A Linux host with Docker and Caddy installed. Caddy must use the
  `import /etc/caddy/conf.d/*.caddyfile` pattern (or be willing to).
- Local: `gh` CLI authenticated; SSH access to the host as a user that
  can write to `/srv/` and edit `/etc/caddy/`.

## Step 1 — Generate a deploy keypair (local)

A dedicated key, used only by GitHub Actions, restricted server-side to a
single command. No passphrase (CI can't enter one).

```sh
ssh-keygen -t ed25519 -f ./x402-deploy -N '' -C 'github-actions:x402.aegent.dev'
```

Two files: `x402-deploy` (private) and `x402-deploy.pub` (public).

## Step 2 — Server: prepare /srv/x402

SSH to the host. From your laptop, copy the four files in this repo's
`deploy/` directory:

```sh
ssh "$SSH_USER@$HOST" 'sudo mkdir -p /srv/x402/data && sudo chown $USER /srv/x402'
scp deploy/docker-compose.yml deploy/env.template \
    deploy/deploy.sh deploy/x402.caddyfile \
    "$SSH_USER@$HOST:/srv/x402/"
```

On the host:

```sh
ssh "$SSH_USER@$HOST"
cd /srv/x402
mv env.template .env
chmod 600 .env
chmod 700 deploy.sh
```

Edit `.env`:

```sh
nano .env
```

Set:

- `PAY_TO=<a wallet address you control on Base Sepolia>` — any wallet
  works for testnet. The server refuses to start on the zero address.
- `SIGNING_SECRET=$(openssl rand -hex 32)` — copy the output of that
  command directly. A stable value means attestations survive restarts.

Leave everything else at defaults for the testnet launch.

## Step 3 — Server: pin the deploy key

Append the public key to the deploy user's `authorized_keys` with a hard
restriction: this key can ONLY run `/srv/x402/deploy.sh`. Stolen key =
redeploy ability, nothing more.

From your laptop:

```sh
KEY="$(cat x402-deploy.pub)"
ssh "$SSH_USER@$HOST" "echo 'command=\"/srv/x402/deploy.sh\",restrict $KEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

If the deploy script needs root (it runs `docker compose`, which usually
does), either: (a) SSH in as root, or (b) make `$SSH_USER` a member of
the `docker` group, or (c) prefix the `docker compose` calls in
`deploy.sh` with `sudo` and grant passwordless `sudo` for those exact
commands via `/etc/sudoers.d/`.

## Step 4 — Cloudflare DNS

In your Cloudflare dashboard for the parent domain, add records pointing
the `x402` subdomain at the host's public IPs:

- Type: `A`, Name: `x402`, Content: `<host IPv4>`, **Proxy: DNS only
  (grey cloud)**, TTL: Auto.
- Type: `AAAA`, Name: `x402`, Content: `<host IPv6>` (if you have one),
  same proxy/TTL.

Grey cloud is required for the initial deploy. Cloudflare's proxy strips
unknown response headers, which would mangle x402's `PAYMENT-REQUIRED`
and `PAYMENT-RESPONSE` headers. Orange cloud can be re-enabled later
behind a Transform Rule that allows those headers — see Operations.

Verify DNS resolves to your host from your laptop:

```sh
dig +short x402.aegent.dev A
dig +short x402.aegent.dev AAAA
```

Both should return the host's IPs.

## Step 5 — Server: enable Caddy site

On the host:

```sh
sudo mv /srv/x402/x402.caddyfile /etc/caddy/conf.d/x402.caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will request a Let's Encrypt cert for `x402.aegent.dev` on the
first request. Watch the logs to confirm:

```sh
sudo journalctl -u caddy -f
```

## Step 6 — GitHub repo secrets (local)

```sh
gh secret set DEPLOY_SSH_KEY --repo dcprevere/x402.aegent.dev < x402-deploy
gh secret set DEPLOY_HOST --repo dcprevere/x402.aegent.dev --body "$HOST"
gh secret set DEPLOY_USER --repo dcprevere/x402.aegent.dev --body "$SSH_USER"
```

`DEPLOY_HOST` is whatever hostname or IP resolves to the box from
GitHub Actions runners.

Then delete the local copy of the private key:

```sh
shred -u x402-deploy x402-deploy.pub
```

## Step 7 — Trigger the first deploy

Two options. If `master` already has the workflow files committed and
pushed, that push already triggered a deploy — go check the Actions tab.

Otherwise:

```sh
git add .github/ deploy/ .dockerignore
git commit -m "Deploy: GitHub Actions + Docker"
git push origin master
```

Watch the run:

```sh
gh run watch --repo dcprevere/x402.aegent.dev
```

Or trigger manually anytime:

```sh
gh workflow run deploy --repo dcprevere/x402.aegent.dev
```

## Step 8 — Smoke test

From anywhere:

```sh
curl https://x402.aegent.dev/healthz
# → {"ok":true}

curl -i 'https://x402.aegent.dev/graphics/figlet/render?text=hi'
# → HTTP 402, with Link headers and a PAYMENT-REQUIRED header

curl -s https://x402.aegent.dev/help | jq .
# → full umbrella catalog
```

Then run the buyer demo against the live URL (from the repo on your
laptop, with a Base-Sepolia-funded wallet):

```sh
export X402_URL=https://x402.aegent.dev
export BUYER_PRIVATE_KEY=0x...
npm run buyer all
```

That's the first end-to-end funded buyer run on the live deployment —
worth marking in `README.md` once it succeeds.

## Operations

### Roll back to a specific image

On the host, edit `/srv/x402/docker-compose.yml`, replace `:latest` with
`:sha-abcd123`, then:

```sh
cd /srv/x402
docker compose pull
docker compose up -d
```

GHCR retains all `sha-*` tags; `latest` is just a moving pointer.

### Tail logs

```sh
docker logs -f x402
```

### Inspect SQLite

```sh
docker exec -it x402 sh
ls -lh /app/data
# sqlite3 isn't in the image — copy the db out instead:
docker cp x402:/app/data/x402.db /tmp/
sqlite3 /tmp/x402.db .tables
```

### Promote to mainnet

Edit `/srv/x402/.env`:

```
NETWORK=eip155:8453
FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
PAY_TO=<your real Base mainnet wallet>
```

Then `docker compose up -d` to restart the container with the new env.
No code changes.

### Add Cloudflare orange-cloud (later, optional)

Two Transform Rules in Cloudflare under Rules → Transform Rules → Modify
Response Header:

1. Name: `x402 PAYMENT-REQUIRED passthrough`. When hostname equals
   `x402.aegent.dev`, set static header `PAYMENT-REQUIRED` to the value
   of the response header `PAYMENT-REQUIRED`.
2. Same for `PAYMENT-RESPONSE`.

Then flip the DNS records to orange cloud. Verify with the smoke test
above. If anything breaks, flip back to grey cloud — that's always safe.
