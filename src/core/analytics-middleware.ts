import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { capture, hashPayer, newDistinctId, type EventName } from "./analytics.js";

interface AnalyticsLocals {
  distinctId: string;
  startedAt: number;
  product: string;
}

/**
 * Per-product analytics middleware factory. Captures request_received on
 * entry and one of payment_required_sent / payment_settled / validation_error
 * / error on response finish, all tagged with the product slug.
 */
export function analyticsMiddleware(product: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const paymentHeader = req.header("x-payment");
    const distinctId = paymentHeader
      ? hashPayer(crypto.createHash("sha256").update(paymentHeader).digest("hex"))
      : newDistinctId();

    const locals = res.locals as { analytics?: AnalyticsLocals };
    locals.analytics = { distinctId, startedAt: Date.now(), product };

    capture(distinctId, "request_received", {
      product,
      route: req.path,
      has_payment_header: paymentHeader !== undefined,
    });

    res.on("finish", () => {
      const latency_ms = Date.now() - locals.analytics!.startedAt;
      const status = res.statusCode;

      let event: EventName | null = null;
      if (status === 402) event = "payment_required_sent";
      else if (status === 400) event = "validation_error";
      else if (status >= 500) event = "error";
      else if (status >= 200 && status < 300 && paymentHeader) event = "payment_settled";

      if (!event) return;

      capture(distinctId, event, {
        product,
        route: req.path,
        status,
        latency_ms,
      });
    });

    next();
  };
}
