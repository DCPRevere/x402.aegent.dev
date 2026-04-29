import express, { type Request, type Response, type NextFunction } from "express";
import { capture } from "../../core/analytics.js";
import { listFonts, render, type Fonts } from "./render.js";
import type { Product } from "../../core/product.js";

const MAX_TEXT_LEN = 256;
const MIN_WIDTH = 20;
const MAX_WIDTH = 200;

let allowedFonts: Set<string> | null = null;
function fontAllowed(name: string): boolean {
  if (!allowedFonts) allowedFonts = new Set(listFonts());
  return allowedFonts.has(name);
}

export interface ValidatedFigletInput {
  text: string;
  font: Fonts;
  width: number | undefined;
}

export function validateFigletInput(query: Request["query"]):
  | { ok: true; value: ValidatedFigletInput }
  | { ok: false; status: number; error: string } {
  const text = typeof query.text === "string" ? query.text : "";
  if (!text) return { ok: false, status: 400, error: "text query parameter is required" };
  if (text.length > MAX_TEXT_LEN)
    return { ok: false, status: 400, error: `text must be <= ${MAX_TEXT_LEN} characters` };

  const font = (typeof query.font === "string" && query.font ? query.font : "Standard") as Fonts;
  if (!fontAllowed(font))
    return { ok: false, status: 400, error: `unknown font: ${font} — see GET /figlet/fonts` };

  let width: number | undefined;
  if (typeof query.width === "string" && query.width !== "") {
    const n = Number(query.width);
    if (!Number.isInteger(n))
      return { ok: false, status: 400, error: "width must be an integer" };
    if (n < MIN_WIDTH || n > MAX_WIDTH)
      return { ok: false, status: 400, error: `width must be in [${MIN_WIDTH}, ${MAX_WIDTH}]` };
    width = n;
  }

  return { ok: true, value: { text, font, width } };
}

export function validateMiddleware(req: Request, res: Response, next: NextFunction) {
  const result = validateFigletInput(req.query);
  if (!result.ok) {
    res.status(result.status).type("text/plain").send(result.error + "\n");
    return;
  }
  (res.locals as { figletInput?: ValidatedFigletInput }).figletInput = result.value;
  next();
}

/**
 * App-level pre-validator: only runs validation on the paid render path,
 * so it returns 400 *before* the paywall sees the request. Other figlet
 * routes (/figlet, /figlet/fonts) pass through untouched.
 */
export function figletPreValidator(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/figlet/render") {
    return validateMiddleware(req, res, next);
  }
  next();
}

async function renderHandler(_req: Request, res: Response) {
  const input = (res.locals as { figletInput?: ValidatedFigletInput }).figletInput;
  if (!input) {
    res.status(500).type("text/plain").send("internal: validator did not run\n");
    return;
  }
  try {
    const startedAt = Date.now();
    const out = await render(input);
    const distinctId = (
      res.locals as { analytics?: { distinctId: string } }
    ).analytics?.distinctId;
    if (distinctId) {
      capture(distinctId, "product_rendered", {
        product: "figlet",
        font: input.font,
        text_length: input.text.length,
        output_lines: out.split("\n").length,
        render_ms: Date.now() - startedAt,
      });
    }
    res.type("text/plain").send(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "render failed";
    res.status(500).type("text/plain").send(`render error: ${msg}\n`);
  }
}

let fontsCache: string[] | null = null;
function fontsHandler(_req: Request, res: Response) {
  if (!fontsCache) fontsCache = listFonts().sort();
  res.json({ fonts: fontsCache, count: fontsCache.length });
}

function infoHandler(req: Request, res: Response) {
  const host = `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(
    `figlet — pay-per-call ASCII art
==================================

Render text in a figfont (https://www.figlet.org). $0.10 per call.

Routes
  GET ${host}/figlet              this page
  GET ${host}/figlet/fonts        list of available fonts (free)
  GET ${host}/figlet/render       render text (PAID $0.10)

Query parameters for /render:
  text   required, max 256 chars
  font   defaults to Standard; see /figlet/fonts
  width  optional, integer 20..200

Try the paywall:
  curl -i '${host}/figlet/render?text=hello'
`,
  );
}

export function figletRouter(): express.Router {
  const router = express.Router();
  router.get("/", infoHandler);
  router.get("/fonts", fontsHandler);
  router.get("/render", renderHandler);
  return router;
}

export const figletProduct: Product = {
  slug: "figlet",
  description: "Render text in a figfont (ASCII-art banners).",
  paidRoutes: [
    {
      method: "GET",
      path: "/figlet/render",
      price: "$0.10",
      description: "Render text in a figfont. $0.10 per call.",
    },
  ],
  preValidators: [figletPreValidator],
  router: figletRouter,
};
