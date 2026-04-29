import type { ProductHelpInput } from "../../../core/help.js";

const FIGLET_LAST_MODIFIED = "2026-04-29T00:00:00Z";

export const figletHelp: ProductHelpInput = {
  name: "graphics/figlet",
  description: "Render text in a figfont (ASCII-art banners). $0.10 per call.",
  tags: ["graphics", "text", "ascii", "figlet"],
  status: "live",
  last_modified: FIGLET_LAST_MODIFIED,
  endpoints: [
    {
      slug: "render",
      name: "graphics/figlet/render",
      description: "Render text in a figfont. $0.10 per call.",
      tags: ["graphics", "text", "paid"],
      status: "live",
      last_modified: FIGLET_LAST_MODIFIED,
      input: {
        params: [
          { name: "text", type: "string", required: true, doc: "Text to render. Max 256 characters." },
          { name: "font", type: "string", required: false, default: "Standard", doc: "Figfont name; see /graphics/figlet/fonts." },
          { name: "width", type: "int", required: false, doc: "Optional width in [20, 200] for word-wrap." },
        ],
      },
      pricing: {
        kind: "flat",
        amount: "100000",
        amount_usdc: "0.10",
      },
      output: {
        media_types: ["text/plain"],
      },
      examples: [
        { request: "GET /graphics/figlet/render?text=hello" },
        { request: "GET /graphics/figlet/render?text=hello&font=Slant" },
      ],
    },
    {
      slug: "fonts",
      name: "graphics/figlet/fonts",
      description: "List available figfont names. Free.",
      tags: ["graphics", "text", "free"],
      status: "live",
      last_modified: FIGLET_LAST_MODIFIED,
      input: { params: [] },
      pricing: { kind: "free" },
      output: {
        media_types: ["application/json"],
      },
      examples: [{ request: "GET /graphics/figlet/fonts" }],
    },
  ],
};
