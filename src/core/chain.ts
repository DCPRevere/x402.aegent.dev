import { createPublicClient, http, type Chain, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { config } from "./config.js";

/**
 * Thin wrapper around a viem PublicClient targeting the configured network.
 *
 * The concrete client type varies per chain (Base vs. Base Sepolia each
 * declare their own block shape), which makes a strongly-typed cache slot
 * fight TypeScript. We cache as `unknown` and narrow inside helpers; the
 * exported surface is the small set of methods /random and /escrow need.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

let _client: AnyClient = null;

function chainFor(caip2: string): Chain {
  if (caip2 === "eip155:8453") return base;
  if (caip2 === "eip155:84532") return baseSepolia;
  throw new Error(`unsupported network for chain client: ${caip2}`);
}

export function getChainClient(): AnyClient {
  if (_client) return _client;
  const chain = chainFor(config.network);
  const transport = config.rpcUrl ? http(config.rpcUrl) : http();
  _client = createPublicClient({ chain, transport });
  return _client;
}

/** Hex blockhash for a given block height. Throws if the block doesn't exist yet. */
export async function getBlockHash(height: bigint): Promise<Hex> {
  const block = await getChainClient().getBlock({ blockNumber: height });
  if (!block?.hash) throw new Error(`block ${height} has no hash (not yet mined?)`);
  return block.hash as Hex;
}

export async function getCurrentBlockNumber(): Promise<bigint> {
  return getChainClient().getBlockNumber();
}

/**
 * Polls until block `height` is mined or `timeoutMs` elapses. For tests, an
 * AbortSignal can short-circuit the wait.
 */
export async function waitForBlock(
  height: bigint,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<Hex> {
  const interval = opts.intervalMs ?? 2_000;
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("waitForBlock aborted");
    try {
      return await getBlockHash(height);
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
    }
  }
  throw new Error(`timed out waiting for block ${height}`);
}

export function setChainClientForTesting(c: AnyClient): void {
  _client = c;
}
