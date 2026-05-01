import type { ProductHelpInput } from "../../core/help.js";

const LAST_MODIFIED = "2026-04-29T00:00:00Z";

export const passportHelp: ProductHelpInput = {
  name: "passport",
  description:
    "Identity attestations for agent wallets. Bind a wallet to ENS/domain/GitHub, " +
    "or prove non-humanness via a programmatic challenge. Other products consume " +
    "passport tokens to gate or discount their endpoints.",
  tags: ["primitive", "identity", "auth"],
  status: "live",
  last_modified: LAST_MODIFIED,
  endpoints: [
    {
      slug: "bind",
      name: "passport/bind",
      description:
        "Bind a wallet to an off-chain identity anchor and receive an HMAC-signed " +
        "90-day attestation. The signed claim ALWAYS includes a `verified: 0|1` flag — " +
        "downstream consumers MUST inspect that flag rather than treating any binding " +
        "as authoritative.\n" +
        "  • ens    — viem getEnsAddress(anchor_value); verified=1 iff resolver returns wallet.\n" +
        "  • domain — HTTPS GET https://{anchor_value}/.well-known/x402-passport;\n" +
        "             verified=1 iff response body contains the wallet address (case-insensitive).\n" +
        "  • gist   — HTTPS GET the gist's raw URL; verified=1 iff body contains the wallet.\n" +
        "Failed verification still records the binding (verified=0) so callers can " +
        "retry without paying again. RPC_URL is recommended in production for ENS to " +
        "avoid public-RPC rate limiting.",
      tags: ["identity", "paid"],
      status: "live",
      last_modified: LAST_MODIFIED,
      input: {
        params: [
          { name: "wallet", type: "address", required: true, doc: "0x-prefixed 20-byte hex address." },
          {
            name: "anchor_kind",
            type: "enum",
            required: true,
            values: ["ens", "domain", "gist"],
            doc: "Which off-chain identity to bind.",
          },
          {
            name: "anchor_value",
            type: "string",
            required: true,
            doc:
              "For ens: an ENS name (e.g. 'alice.eth'). " +
              "For domain: a hostname (no scheme); we fetch /.well-known/x402-passport. " +
              "For gist: a gist URL (raw or html form).",
          },
        ],
      },
      pricing: { kind: "flat", amount: "100000", amount_usdc: "0.10" },
      output: { media_types: ["application/json"] },
      examples: [
        { request: "POST /passport/bind { wallet, anchor_kind: 'ens', anchor_value: 'alice.eth' }" },
        { request: "POST /passport/bind { wallet, anchor_kind: 'domain', anchor_value: 'me.example.com' }" },
        { request: "GET /passport/bind/<wallet>" },
      ],
    },
    {
      slug: "anti-captcha",
      name: "passport/anti-captcha",
      description:
        "Formally-specified proof-of-work challenge: find a nonce whose hash has N leading " +
        "zero bits. Trivially programmable; impractical for humans. Issuing a pass binds " +
        "to a wallet with a 24-hour TTL.",
      tags: ["identity", "anti-human", "paid"],
      status: "live",
      last_modified: LAST_MODIFIED,
      input: {
        params: [
          { name: "wallet", type: "address", required: true, doc: "Wallet to issue the pass to." },
          { name: "difficulty", type: "int", required: false, default: 18, doc: "Leading-zero bits required (12..28)." },
        ],
      },
      pricing: { kind: "flat", amount: "1000", amount_usdc: "0.001" },
      output: { media_types: ["application/json"] },
      examples: [
        { request: "POST /passport/anti-captcha/challenge { wallet, difficulty }" },
        { request: "POST /passport/anti-captcha/solve { challenge_id, nonce }" },
      ],
    },
    {
      slug: "username",
      name: "passport/username",
      description:
        "Claim a permanent handle bound to a wallet and an X25519 encryption pubkey. " +
        "Other products that take a wallet may accept '@username' instead. The wallet " +
        "must sign the canonical claim message ('x402.aegent.dev passport:claim " +
        "username=<name> pubkey=<base64>') with EIP-191 personal_sign — this proves the " +
        "wallet authorizes the binding. The pubkey enables end-to-end encrypted " +
        "messaging (senders encrypt to it; the server stores ciphertext only).\n" +
        "Permanence: claims do not expire and cannot be transferred. Names matching " +
        "UUID v4 are rejected so usernames never collide with auto-generated ids. " +
        "A small reserved list (product slugs + admin/root/etc.) is blocked.",
      tags: ["identity", "paid"],
      status: "live",
      last_modified: LAST_MODIFIED,
      input: {
        params: [
          {
            name: "username",
            type: "string",
            required: true,
            doc: "4-32 chars, lowercase alnum + _ or -, no leading/trailing punctuation.",
          },
          { name: "wallet", type: "address", required: true, doc: "Owning wallet, EIP-191 signer." },
          {
            name: "pubkey",
            type: "string",
            required: true,
            doc: "X25519 encryption pubkey, 32 bytes base64 (44 chars including padding).",
          },
          {
            name: "wallet_signature",
            type: "string",
            required: true,
            doc:
              "EIP-191 personal_sign over the canonical claim message. " +
              "0x-prefixed hex.",
          },
        ],
      },
      pricing: { kind: "flat", amount: "10000000", amount_usdc: "10.00" },
      output: { media_types: ["application/json"] },
      examples: [
        { request: "POST /passport/username { username, wallet, pubkey, wallet_signature }" },
        { request: "GET /passport/username/<name>" },
        { request: "GET /passport/username/by-wallet/<wallet>" },
        {
          request:
            "POST /passport/username/<name>/rotate { new_pubkey, signature } — currently 501; reserved for v2.",
        },
      ],
    },
  ],
};
