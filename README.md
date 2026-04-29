# x402.dcprevere.com

A small collection of pay-per-call APIs that demonstrate what the agentic
economy might look like. Each product is a real HTTP API that charges in
USDC on Base via the [x402][x402] protocol — no accounts, no API keys, no
human in the loop. An agent with a wallet can transact.

## Products

| Product                            | What it does                                  | Price | Status |
| ---------------------------------- | --------------------------------------------- | ----- | ------ |
| [`figpay/`](./figpay)              | Renders text in a figfont (ASCII-art banners) | $0.10 | live   |

More to come.

## Why x402

[x402][x402] reuses the long-reserved `HTTP 402 Payment Required` status
code: a server returns 402 with machine-readable payment instructions, the
client signs a USDC transfer from its wallet, retries with the payment
header, and gets the resource. The seller only needs a wallet address — no
custody, no PCI, no Stripe account, no API key issuance. Verification and
on-chain settlement are handled by a hosted *facilitator* HTTP service.

Every product in this repo follows the same shape, so consumers (humans or
agents) can switch between them without re-onboarding.

## Repo layout

```
x402.dcprevere.com/
├── README.md       # this file (the umbrella)
├── .gitignore
└── <product>/      # each product is self-contained: own package.json,
                    # own deploy, own subdomain
```

Per-product details live in each product's own README.

## Network

Currently all products default to **Base Sepolia** (testnet, free, no
signup) using the open `https://x402.org/facilitator`. Mainnet is a config
flip per product — see each product's README.

[x402]: https://www.x402.org/
