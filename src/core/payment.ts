import type { Request, Response, NextFunction, RequestHandler } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { config } from "./config.js";
import { log } from "./log.js";
import type { PaidRoute } from "./product.js";

/**
 * Build a single x402 paymentMiddleware that protects all paid routes across
 * all products. One facilitator client, one resource server, one
 * registration of the EVM scheme — products just declare their PaidRoutes.
 */
export function buildPaymentMiddleware(routes: PaidRoute[]): RequestHandler {
  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    config.network,
    new ExactEvmScheme(),
  );

  type PriceCtx = { adapter: { getBody?: () => unknown } };
  type DynamicPrice = (ctx: PriceCtx) => string;

  const routesConfig: Record<
    string,
    {
      accepts: {
        scheme: "exact";
        price: string | DynamicPrice;
        network: `${string}:${string}`;
        payTo: `0x${string}`;
        maxTimeoutSeconds: number;
      };
      description: string;
    }
  > = {};

  for (const r of routes) {
    let price: string | DynamicPrice;
    if (typeof r.price === "string") {
      price = r.price;
    } else {
      const fn = r.price;
      const fallback = r.displayPrice ?? "$0.00";
      price = (ctx) => {
        // x402's HTTPRequestContext doesn't carry the Express req, but the
        // adapter exposes the parsed body — which is all parametric pricing
        // currently needs. Construct a minimal Request-shaped object so the
        // PriceFn signature stays Express-native.
        const body = ctx.adapter.getBody?.() ?? {};
        try {
          return fn({ body } as unknown as Request);
        } catch (err) {
          log.warn("price_fn_threw", {
            route: `${r.method} ${r.path}`,
            message: err instanceof Error ? err.message : String(err),
          });
          return fallback;
        }
      };
    }
    routesConfig[`${r.method} ${r.path}`] = {
      accepts: {
        scheme: "exact",
        price,
        network: config.network,
        payTo: config.payTo,
        maxTimeoutSeconds: 60,
      },
      description: r.description,
    };
  }

  const middleware = paymentMiddleware(routesConfig, resourceServer);

  // Wrap so 402 responses always carry Link headers pointing at the local
  // help node and the global catalog. Lets agents that hit a paywall they
  // don't recognise discover both this resource's docs and the umbrella's
  // full menu in one round-trip.
  return function paymentWithLinkHeaders(req: Request, res: Response, next: NextFunction) {
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = function patchedWriteHead(...args: unknown[]) {
      if (res.statusCode === 402 && !res.getHeader("Link")) {
        res.setHeader("Link", LINK_HEADER_VALUE);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalWriteHead as any)(...args);
    } as typeof res.writeHead;
    middleware(req, res, next);
  };
}

// Relative URLs: `./help` is resolved by the client against the request URL,
// so a 402 on /graphics/figlet/render points to /graphics/figlet/render/help.
// The help middleware treats trailing /help as the help suffix.
const LINK_HEADER_VALUE = `<./help>; rel="self-help", </help>; rel="catalog"`;
