import crypto from "node:crypto";
import { canonicalJson } from "../../core/help.js";

/**
 * Server-signed attestations for passport bindings and anti-captcha passes.
 *
 * Uses HMAC-SHA256 with PASSPORT_SECRET (from env, or a per-process default
 * for development/test). HMAC is sufficient because there's a single trusted
 * issuer (this server) — there's no off-chain verifier we need to interoperate
 * with. If/when a downstream wants to verify outside this server, swap to
 * EIP-712 signatures with a configured EOA.
 */

let cachedSecret: Buffer | null = null;

function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const env = process.env.PASSPORT_SECRET;
  if (env && env.length >= 16) {
    cachedSecret = Buffer.from(env, "utf8");
  } else {
    // Per-process random secret. Survives process lifetime; tokens issued in
    // one process cannot be verified by another. Fine for dev and tests.
    cachedSecret = crypto.randomBytes(32);
  }
  return cachedSecret;
}

export function resetSecretForTesting(secret?: string): void {
  cachedSecret = secret ? Buffer.from(secret, "utf8") : null;
}

export function signClaim(payload: Record<string, unknown>): string {
  const json = canonicalJson(payload);
  const mac = crypto.createHmac("sha256", getSecret()).update(json).digest("hex");
  return mac;
}

export function verifyClaim(payload: Record<string, unknown>, signature: string): boolean {
  const expected = signClaim(payload);
  // Constant-time compare.
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
