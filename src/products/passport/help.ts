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
        "Bind a wallet to an off-chain identity anchor (ENS name, domain, or GitHub gist). " +
        "Issues a signed attestation valid for 90 days. ENS bindings are verified online; " +
        "domain/gist bindings record the claim and mark verification status.",
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
          { name: "anchor_value", type: "string", required: true, doc: "ENS name, domain, or gist URL." },
        ],
      },
      pricing: { kind: "flat", amount: "100000", amount_usdc: "0.10" },
      output: { media_types: ["application/json"] },
      examples: [
        { request: "POST /passport/bind { wallet, anchor_kind: 'ens', anchor_value: 'foo.eth' }" },
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
  ],
};
