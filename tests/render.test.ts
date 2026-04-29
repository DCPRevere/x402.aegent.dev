import { describe, it, expect } from "vitest";
import { listFonts, render } from "../src/products/graphics/figlet/render.js";

describe("figlet render", () => {
  it("lists at least one font", () => {
    expect(listFonts().length).toBeGreaterThan(0);
  });

  it("includes Standard and Slant in the bundled fonts", () => {
    const fonts = new Set(listFonts());
    expect(fonts.has("Standard")).toBe(true);
    expect(fonts.has("Slant")).toBe(true);
  });

  it("renders text in the default font", async () => {
    const out = await render({ text: "hi" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.split("\n").length).toBeGreaterThan(1);
  });

  it("renders text in Slant", async () => {
    const out = await render({ text: "hi", font: "Slant" });
    expect(out.length).toBeGreaterThan(0);
  });
});
