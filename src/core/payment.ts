import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { config } from "./config.js";
import type { PaidRoute } from "./product.js";

/**
 * Build a single x402 paymentMiddleware that protects all paid routes across
 * all products. One facilitator client, one resource server, one
 * registration of the EVM scheme — products just declare their PaidRoutes.
 */
export function buildPaymentMiddleware(routes: PaidRoute[]) {
  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    config.network,
    new ExactEvmScheme(),
  );

  const routesConfig: Record<
    string,
    {
      accepts: {
        scheme: "exact";
        price: string;
        network: `${string}:${string}`;
        payTo: `0x${string}`;
        maxTimeoutSeconds: number;
      };
      description: string;
    }
  > = {};

  for (const r of routes) {
    routesConfig[`${r.method} ${r.path}`] = {
      accepts: {
        scheme: "exact",
        price: r.price,
        network: config.network,
        payTo: config.payTo,
        maxTimeoutSeconds: 60,
      },
      description: r.description,
    };
  }

  return paymentMiddleware(routesConfig, resourceServer);
}
