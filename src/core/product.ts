import type { Router, RequestHandler, Request } from "express";
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

/**
 * Per-request price function. Receives the parsed request and returns the
 * dollar string the paywall should charge. Used for parametric pricing where
 * cost depends on body fields (e.g. /escrow/create scales with amount_usdc).
 *
 * Pre-validators run before the paywall, so by the time this fires the body
 * is already parsed and validated. Throwing falls through to the default
 * displayPrice; returning a non-positive price is a programming error.
 */
export type PriceFn = (req: Request) => string;

export interface PaidRoute {
  /** Express method, uppercase, e.g. "GET". */
  method: "GET" | "POST";
  /** Full request path the paywall must match, e.g. "/graphics/figlet/render". */
  path: string;
  /**
   * USDC amount as a dollar string (e.g. "$0.10"), or a function that returns
   * one given the request. Leading $ is required by x402.
   */
  price: string | PriceFn;
  /**
   * Human-readable price for landing pages and the 402 fallback. Required when
   * `price` is a function (since the function needs a request to evaluate);
   * defaults to `price` when it's a static string.
   */
  displayPrice?: string;
  /** Human-readable description shown in the 402 response. */
  description: string;
}
