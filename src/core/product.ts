import type { Router, RequestHandler } from "express";
import type { ProductHelpInput } from "./help.js";

/**
 * Each product is a self-contained x402-paid API mounted under /<slug>.
 * The umbrella server merges all products' paidRoutes into one paymentMiddleware
 * call, then mounts each product's router.
 *
 * preValidators run *before* the paywall so a request with bad input returns
 * 400 without ever reaching 402 — buyers don't pay for invalid requests.
 *
 * The `slug` may contain slashes (e.g. "graphics/figlet"); the umbrella mounts
 * the router at `/<slug>` literally and registers `<slug>` with the help
 * registry as the product's mountPath.
 */
export interface Product {
  slug: string;
  description: string;
  paidRoutes: PaidRoute[];
  preValidators?: RequestHandler[];
  router(): Router;
  /** Descriptor consumed by the help registry. */
  help: ProductHelpInput;
}

export interface PaidRoute {
  /** Express method, uppercase, e.g. "GET". */
  method: "GET" | "POST";
  /** Full request path the paywall must match, e.g. "/graphics/figlet/render". */
  path: string;
  /** USDC amount as a dollar string, e.g. "$0.10". Leading $ is required by x402. */
  price: string;
  /** Human-readable description shown in the 402 response. */
  description: string;
}
