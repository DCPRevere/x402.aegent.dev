import crypto from "node:crypto";
import { PostHog } from "posthog-node";
import { config } from "./config.js";

let client: PostHog | null = null;

if (config.posthogKey) {
  client = new PostHog(config.posthogKey, {
    host: config.posthogHost,
    flushAt: 1,
    flushInterval: 5000,
  });
}

export type EventName =
  | "request_received"
  | "payment_required_sent"
  | "payment_settled"
  | "product_rendered"
  | "validation_error"
  | "error";

export function capture(
  distinctId: string,
  event: EventName,
  properties: Record<string, unknown> = {},
) {
  if (!client) return;
  client.capture({
    distinctId,
    event,
    properties: {
      service: "x402.dcprevere.com",
      network: config.network,
      ...properties,
    },
  });
}

export async function shutdown() {
  if (!client) return;
  await client.shutdown();
}

export function hashPayer(addr: string): string {
  return crypto.createHash("sha256").update(addr.toLowerCase()).digest("hex").slice(0, 12);
}

export function newDistinctId(): string {
  return `anon-${crypto.randomBytes(6).toString("hex")}`;
}
