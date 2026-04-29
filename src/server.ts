import express from "express";
import { config } from "./core/config.js";
import { buildLandingHandler, healthHandler } from "./core/landing.js";
import { buildPaymentMiddleware } from "./core/payment.js";
import { analyticsMiddleware } from "./core/analytics-middleware.js";
import { shutdown as shutdownAnalytics } from "./core/analytics.js";
import type { Product } from "./core/product.js";
import { figletProduct } from "./products/figlet/router.js";

const products: Product[] = [figletProduct];

const app = express();
app.disable("x-powered-by");

// Free, top-level routes.
app.get("/", buildLandingHandler(products));
app.get("/healthz", healthHandler);

// Order matters:
//   1. Per-product analytics (captures request_received and final-status events).
//   2. Per-product preValidators (return 400 *before* the paywall, so buyers
//      never pay for invalid input).
//   3. App-level paywall: matches paid routes by full request path.
//   4. Per-product router: handles the actual response.
const allPaidRoutes = products.flatMap((p) => p.paidRoutes);

for (const product of products) {
  app.use(`/${product.slug}`, analyticsMiddleware(product.slug));
  for (const v of product.preValidators ?? []) {
    app.use(v);
  }
}

app.use(buildPaymentMiddleware(allPaidRoutes));

for (const product of products) {
  app.use(`/${product.slug}`, product.router());
}

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `x402.dcprevere.com listening on :${config.port} ` +
      `(network=${config.network}, products=${products.map((p) => p.slug).join(",")})`,
  );
});

async function gracefulShutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`received ${signal}, shutting down`);
  server.close();
  await shutdownAnalytics();
  process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
