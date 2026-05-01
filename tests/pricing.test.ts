import { describe, it, expect } from "vitest";
import { usdcBaseUnits, usdcPricing, baseUnitsToPrice } from "../src/core/pricing.js";

describe("usdcBaseUnits", () => {
  it("converts whole-dollar amounts", () => {
    expect(usdcBaseUnits("1")).toBe("1000000");
    expect(usdcBaseUnits("10")).toBe("10000000");
  });

  it("converts cent amounts", () => {
    expect(usdcBaseUnits("0.10")).toBe("100000");
    expect(usdcBaseUnits("0.05")).toBe("50000");
    expect(usdcBaseUnits("0.01")).toBe("10000");
  });

  it("converts sub-cent amounts to the precision USDC supports", () => {
    expect(usdcBaseUnits("0.005")).toBe("5000");
    expect(usdcBaseUnits("0.001")).toBe("1000");
    expect(usdcBaseUnits("0.000001")).toBe("1");
  });

  it("rejects more than 6 decimal places", () => {
    expect(() => usdcBaseUnits("0.0000001")).toThrow();
  });

  it("rejects malformed inputs", () => {
    expect(() => usdcBaseUnits("$0.10")).toThrow();
    expect(() => usdcBaseUnits("0.1.2")).toThrow();
    expect(() => usdcBaseUnits("not a number")).toThrow();
  });

  it("usdcPricing returns both forms", () => {
    expect(usdcPricing("0.10")).toEqual({ amount: "100000", amount_usdc: "0.10" });
  });
});

describe("baseUnitsToPrice", () => {
  it("formats whole-dollar amounts", () => {
    expect(baseUnitsToPrice(1_000_000n)).toBe("$1.00");
    expect(baseUnitsToPrice(100_000_000n)).toBe("$100.00");
  });

  it("formats cent amounts", () => {
    expect(baseUnitsToPrice(100_000n)).toBe("$0.10");
    expect(baseUnitsToPrice(10_000n)).toBe("$0.01");
    expect(baseUnitsToPrice(50_000n)).toBe("$0.05");
  });

  it("formats sub-cent amounts and trims zeros past two decimals", () => {
    expect(baseUnitsToPrice(5_000n)).toBe("$0.005");
    expect(baseUnitsToPrice(1_000n)).toBe("$0.001");
  });

  it("handles zero", () => {
    expect(baseUnitsToPrice(0n)).toBe("$0.00");
  });

  it("rejects negative units", () => {
    expect(() => baseUnitsToPrice(-1n)).toThrow();
  });

  it("handles very large amounts without overflow", () => {
    expect(baseUnitsToPrice(123_456_789_012_345n)).toBe("$123456789.012345");
  });
});
