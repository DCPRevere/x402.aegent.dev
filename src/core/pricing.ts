/**
 * USDC pricing helpers. USDC has 6 decimal places; a $0.10 charge is
 * 100000 base units. We need both forms in /help (machine-readable amount
 * and human-readable amount_usdc) and they must always agree, so derive
 * one from the other.
 *
 * Fixes review item #26.
 */

const DECIMALS = 6;

/**
 * Convert a human-readable USDC amount (e.g. "0.10", "0.005") to the base-units
 * decimal string used in /help and on-chain transfers.
 */
export function usdcBaseUnits(human: string): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(human)) {
    throw new Error(`usdcBaseUnits: not a valid USDC amount: ${human}`);
  }
  const [intPart, fracPart = ""] = human.split(".");
  const padded = (fracPart + "0".repeat(DECIMALS)).slice(0, DECIMALS);
  const combined = (intPart + padded).replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}

export interface UsdcPricing {
  amount: string;
  amount_usdc: string;
}

/** Build a {amount, amount_usdc} pair from a single human source-of-truth. */
export function usdcPricing(human: string): UsdcPricing {
  return { amount_usdc: human, amount: usdcBaseUnits(human) };
}

/**
 * Convert a USDC base-units bigint to the human-readable decimal string that
 * x402's `Price` type accepts (e.g. 100000n → "$0.10"). Strips trailing zeros
 * past two decimal places but always keeps at least two decimals so the
 * rendered price reads as a normal currency amount.
 */
export function baseUnitsToPrice(units: bigint): string {
  if (units < 0n) throw new Error(`baseUnitsToPrice: negative units ${units}`);
  const divisor = 10n ** BigInt(DECIMALS);
  const intPart = units / divisor;
  const fracPart = units % divisor;
  const fracStr = fracPart.toString().padStart(DECIMALS, "0");
  // Keep at least 2 decimal places; trim trailing zeros beyond that.
  let trimmed = fracStr.replace(/0+$/, "");
  if (trimmed.length < 2) trimmed = fracStr.slice(0, 2);
  return `$${intPart.toString()}.${trimmed}`;
}
