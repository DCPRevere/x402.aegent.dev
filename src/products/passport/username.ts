import type { Request, Response, NextFunction } from "express";
import { verifyMessage } from "viem";
import { signClaim } from "../../core/sign.js";
import { isAddress } from "../../core/addr.js";
import { log } from "../../core/log.js";
import {
  getUsername,
  insertUsername,
  listUsernamesByWallet,
  rotateUsernamePubkey,
  type UsernameRow,
} from "./state.js";

/**
 * /passport/username — claim a permanent handle bound to a wallet and an
 * X25519 encryption pubkey. $10 to claim, free to read, free to rotate.
 *
 * The wallet signature at claim time proves the wallet authorizes the
 * (username, pubkey) pair — without it the wallet field would be ornamental
 * and downstream products could not trust the binding.
 *
 * Rotation is signed by the OLD pubkey: anyone who controls the current
 * encryption privkey can post a new pubkey. This handles the "lost device"
 * case without a recovery wallet round-trip, but means losing the privkey
 * without rotating first is unrecoverable. Documented in /help.
 */

const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{2,30}[a-z0-9]$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Names we never let anyone claim. Three buckets:
 *
 *   1. Product / brand identifiers — keep the operator's identity and the
 *      umbrella's brand off the squat market.
 *   2. Product slugs — so /wire/inbox/wire stays unambiguous and so future
 *      products can't be impersonated by an existing username.
 *   3. System-y handles people read as authoritative ("root", "admin").
 *
 * UUID-shaped strings are rejected separately by USERNAME_REGEX so usernames
 * can never collide with auto-generated inbox / commit / escrow ids.
 */
const RESERVED_NAMES = new Set([
  // Brand & operator identity
  "x402",
  "aegent",
  "dcprevere",
  "official",
  "team",
  "support",
  "billing",
  "abuse",
  // Product slugs (current & plausibly-future)
  "wire",
  "passport",
  "escrow",
  "random",
  "agora",
  "graphics",
  "figlet",
  // System-y / authority-implying handles
  "help",
  "admin",
  "owner",
  "ops",
  "root",
  "api",
  "null",
  "system",
  "anonymous",
  "moderator",
]);

export function isReservedUsername(name: string): boolean {
  return RESERVED_NAMES.has(name.toLowerCase());
}

export function isValidUsername(name: string): boolean {
  if (typeof name !== "string") return false;
  if (UUID_REGEX.test(name)) return false;
  return USERNAME_REGEX.test(name);
}

/**
 * X25519 pubkeys are 32 raw bytes. We accept and store them as base64 for
 * wire compatibility (44 chars including `=` padding). The server doesn't
 * use the pubkey itself — it just hands it to senders who encrypt to it —
 * so we only need to validate length and encoding.
 */
const PUBKEY_B64_LEN = 44;
export function isValidPubkey(pubkey: string): boolean {
  if (typeof pubkey !== "string" || pubkey.length !== PUBKEY_B64_LEN) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pubkey)) return false;
  try {
    return Buffer.from(pubkey, "base64").length === 32;
  } catch {
    return false;
  }
}

/**
 * The exact UTF-8 message the wallet must sign at claim time. Including the
 * "x402.aegent.dev" prefix and `claim:` action prevents replay against other
 * apps or future passport actions; including the pubkey binds the signature
 * to a specific encryption key.
 */
export function claimMessage(username: string, pubkey: string): string {
  return `x402.aegent.dev passport:claim username=${username.toLowerCase()} pubkey=${pubkey}`;
}

/** Rotation message. Bound to the new pubkey only — the old one is implicit (it's what verifies). */
export function rotateMessage(username: string, newPubkey: string): string {
  return `x402.aegent.dev passport:rotate username=${username.toLowerCase()} new_pubkey=${newPubkey}`;
}

interface ParsedClaim {
  username: string;
  wallet: string;
  pubkey: string;
  wallet_signature: string;
}

export function parseClaimBody(body: Record<string, unknown>):
  | { ok: true; value: ParsedClaim }
  | { ok: false; error: string } {
  // Validate against the original string before lowercasing so callers can't
  // sneak past the lowercase-only rule by sending mixed case. Lowercase
  // afterwards for storage.
  const username = typeof body.username === "string" ? body.username : "";
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  const pubkey = typeof body.pubkey === "string" ? body.pubkey : "";
  const wallet_signature = typeof body.wallet_signature === "string" ? body.wallet_signature : "";

  if (!isValidUsername(username)) {
    return {
      ok: false,
      error:
        "username must be 4-32 chars, lowercase alphanumeric plus _ or -, " +
        "no leading/trailing punctuation, and not UUID-shaped",
    };
  }
  if (isReservedUsername(username)) {
    return { ok: false, error: `username '${username}' is reserved` };
  }
  if (!isAddress(wallet)) {
    return { ok: false, error: "wallet must be a 0x-prefixed 20-byte hex address" };
  }
  if (!isValidPubkey(pubkey)) {
    return { ok: false, error: "pubkey must be a 32-byte X25519 key, base64-encoded" };
  }
  if (!/^0x[0-9a-f]+$/i.test(wallet_signature)) {
    return { ok: false, error: "wallet_signature must be a 0x-prefixed hex string" };
  }
  return {
    ok: true,
    value: { username: username.toLowerCase(), wallet, pubkey, wallet_signature },
  };
}

interface ParsedRotate {
  new_pubkey: string;
  signature: string;
}

export function parseRotateBody(body: Record<string, unknown>):
  | { ok: true; value: ParsedRotate }
  | { ok: false; error: string } {
  const new_pubkey = typeof body.new_pubkey === "string" ? body.new_pubkey : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!isValidPubkey(new_pubkey)) {
    return { ok: false, error: "new_pubkey must be a 32-byte X25519 key, base64-encoded" };
  }
  if (typeof signature !== "string" || signature.length === 0) {
    return { ok: false, error: "signature is required" };
  }
  return { ok: true, value: { new_pubkey, signature } };
}

// ----- Pre-validator --------------------------------------------------

/**
 * Runs before the paywall. Validates the claim body so a buyer never pays $10
 * for a malformed username, reserved name, bad pubkey, or unsigned request.
 * Stashes the parsed body on res.locals for the handler to consume without
 * re-parsing.
 */
export function usernamePreValidator(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "POST" || req.path !== "/username") return next();
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "JSON body required" });
    return;
  }
  const parsed = parseClaimBody(req.body as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  res.locals.usernameClaim = parsed.value;
  next();
}

// ----- Handlers -------------------------------------------------------

export async function claimUsernameHandler(_req: Request, res: Response) {
  const input = res.locals.usernameClaim as ParsedClaim | undefined;
  if (!input) {
    res.status(500).json({ error: "internal: validator did not run" });
    return;
  }

  // Wallet must have signed the canonical claim message. This proves the
  // wallet authorizes the (username, pubkey) binding.
  const message = claimMessage(input.username, input.pubkey);
  let valid = false;
  try {
    valid = await verifyMessage({
      address: input.wallet as `0x${string}`,
      message,
      signature: input.wallet_signature as `0x${string}`,
    });
  } catch (err) {
    log.warn("username_claim_sig_threw", {
      username: input.username,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  if (!valid) {
    res.status(400).json({ error: "wallet_signature does not verify against wallet" });
    return;
  }

  // Idempotency / squatting: PRIMARY KEY collision returns 409.
  if (getUsername(input.username)) {
    res.status(409).json({ error: "username already claimed" });
    return;
  }

  const claimed_at = new Date().toISOString();
  const claim = {
    username: input.username,
    wallet: input.wallet.toLowerCase(),
    pubkey: input.pubkey,
    claimed_at,
  };
  const signature = signClaim(claim);
  let row: UsernameRow;
  try {
    row = insertUsername({ ...claim, signature });
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      res.status(409).json({ error: "username already claimed" });
      return;
    }
    throw err;
  }
  log.info("username_claimed", { username: row.username, wallet: row.wallet });
  res.status(201).json({ username: row, attestation: { claim, signature } });
}

export function getUsernameHandler(req: Request, res: Response) {
  const row = getUsername(req.params.name);
  if (!row) {
    res.status(404).json({ error: "no such username" });
    return;
  }
  res.json({ username: row });
}

export function listUsernamesByWalletHandler(req: Request, res: Response) {
  const wallet = req.params.wallet;
  if (!isAddress(wallet)) {
    res.status(400).json({ error: "wallet must be a 0x-prefixed 20-byte hex address" });
    return;
  }
  res.json({ usernames: listUsernamesByWallet(wallet) });
}

/**
 * Rotate the encryption pubkey for an existing username. Authenticated by a
 * signature from the *current* pubkey (Ed25519/X25519 signature, base64).
 *
 * NOTE: We document this surface but do NOT verify the signature here yet —
 * X25519 is encryption-only; signature verification needs an Ed25519 pubkey
 * we don't currently store. A v2 will add `sign_pubkey` alongside the
 * encryption key. Until then, rotation is gated only by username ownership
 * (the caller must already control the current row's pubkey to derive a
 * valid signature for the upgraded scheme). For now, refuse all rotations
 * with 501 so we don't ship a footgun.
 */
export function rotateUsernameHandler(req: Request, res: Response) {
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "JSON body required" });
    return;
  }
  const parsed = parseRotateBody(req.body as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const row = getUsername(req.params.name);
  if (!row) {
    res.status(404).json({ error: "no such username" });
    return;
  }
  // Intentional: see docstring above. Keeps the surface in /help (and the
  // table column) so v2 can land without a schema change.
  res.status(501).json({
    error:
      "rotation requires a separate signing pubkey not yet stored on claims; " +
      "v2 will add an Ed25519 sign_pubkey field to enable this.",
    detail: { username: row.username, requested_new_pubkey: parsed.value.new_pubkey },
  });
}

// Exported for tests only — exercises the table update path once v2 lands.
export function _rotateForTesting(
  username: string,
  newPubkey: string,
): UsernameRow | null {
  const rotated_at = new Date().toISOString();
  const row = getUsername(username);
  if (!row) return null;
  const claim = { username: row.username, wallet: row.wallet, pubkey: newPubkey, rotated_at };
  const signature = signClaim(claim);
  return rotateUsernamePubkey(username, newPubkey, rotated_at, signature);
}
