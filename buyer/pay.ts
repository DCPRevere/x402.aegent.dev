import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

const baseUrl = process.env.X402_URL ?? "http://localhost:4021";
const networkRaw = process.env.NETWORK ?? "eip155:84532";
if (!/^[^:]+:[^:]+$/.test(networkRaw)) {
  console.error(`NETWORK must be CAIP-2 (e.g. eip155:84532), got: ${networkRaw}`);
  process.exit(1);
}
const network = networkRaw as `${string}:${string}`;
const privateKey = process.env.BUYER_PRIVATE_KEY;

if (!privateKey) {
  console.error(
    "Set BUYER_PRIVATE_KEY (a Sepolia-only test wallet). See buyer/README.md for faucet links.",
  );
  process.exit(1);
}

// Demo: hit the figlet product's paid endpoint.
const text = process.argv.slice(2).join(" ") || "hello agent";
const font = process.env.FONT ?? "Slant";
const target = `${baseUrl}/figlet/render?text=${encodeURIComponent(text)}&font=${encodeURIComponent(font)}`;

const account = privateKeyToAccount(privateKey as `0x${string}`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network,
      client: new ExactEvmScheme(account),
    },
  ],
});

console.error(`buyer: ${account.address}`);
console.error(`GET ${target}`);

const res = await fetchWithPayment(target, { method: "GET" });
const body = await res.text();

if (!res.ok) {
  console.error(`error: HTTP ${res.status}`);
  console.error(body);
  process.exit(1);
}

const paymentResponse =
  res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
if (paymentResponse) {
  try {
    const decoded = decodePaymentResponseHeader(paymentResponse);
    console.error(`paid: ${JSON.stringify(decoded)}`);
  } catch {
    console.error(`paid: (response header present, decode failed)`);
  }
}

process.stdout.write(body);
if (!body.endsWith("\n")) process.stdout.write("\n");
