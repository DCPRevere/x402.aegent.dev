import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { privateKeyToAccount } from "viem/accounts";
import { setDbForTesting, runMigrations, closeDb } from "../src/core/persist.js";
import { PASSPORT_MIGRATIONS } from "../src/products/passport/state.js";
import {
  passportProduct,
  passportRouter,
} from "../src/products/passport/router.js";
import {
  claimMessage,
  isReservedUsername,
  isValidPubkey,
  isValidUsername,
  parseClaimBody,
  usernamePreValidator,
  _rotateForTesting,
} from "../src/products/passport/username.js";
import { getUsername } from "../src/products/passport/state.js";
import { resetSecretForTesting } from "../src/core/sign.js";

const PRIVKEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(PRIVKEY);
const WALLET = account.address;

const PUBKEY = Buffer.alloc(32, 7).toString("base64");
const PUBKEY_2 = Buffer.alloc(32, 9).toString("base64");

function freshApp(): Express {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/passport", usernamePreValidator);
  app.use("/passport", passportRouter());
  return app;
}

async function signClaimWithWallet(username: string, pubkey: string): Promise<`0x${string}`> {
  return account.signMessage({ message: claimMessage(username, pubkey) });
}

describe("/passport/username", () => {
  beforeEach(() => {
    closeDb();
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    setDbForTesting(db);
    runMigrations(PASSPORT_MIGRATIONS);
    resetSecretForTesting();
  });

  afterAll(() => {
    closeDb();
  });

  describe("validation helpers", () => {
    it("isValidUsername accepts well-formed names", () => {
      expect(isValidUsername("alice")).toBe(true);
      expect(isValidUsername("bob_the_builder")).toBe(true);
      expect(isValidUsername("a-b-c")).toBe(true);
      expect(isValidUsername("user1234567890")).toBe(true);
    });

    it("isValidUsername rejects malformed names", () => {
      expect(isValidUsername("")).toBe(false);
      expect(isValidUsername("ab")).toBe(false); // too short
      expect(isValidUsername("a".repeat(33))).toBe(false); // too long
      expect(isValidUsername("Alice")).toBe(false); // uppercase
      expect(isValidUsername("-leading")).toBe(false);
      expect(isValidUsername("trailing-")).toBe(false);
      expect(isValidUsername("has space")).toBe(false);
      expect(isValidUsername("has.dot")).toBe(false);
      expect(isValidUsername("has/slash")).toBe(false);
    });

    it("isValidUsername rejects UUID-shaped names", () => {
      expect(isValidUsername("11111111-2222-3333-4444-555555555555")).toBe(false);
    });

    it("isReservedUsername blocks brand, product, and system handles", () => {
      // Brand / operator
      expect(isReservedUsername("x402")).toBe(true);
      expect(isReservedUsername("aegent")).toBe(true);
      expect(isReservedUsername("dcprevere")).toBe(true);
      expect(isReservedUsername("support")).toBe(true);
      // Product slugs
      expect(isReservedUsername("wire")).toBe(true);
      expect(isReservedUsername("passport")).toBe(true);
      // System
      expect(isReservedUsername("admin")).toBe(true);
      expect(isReservedUsername("owner")).toBe(true);
      expect(isReservedUsername("ops")).toBe(true);
      // Case-insensitive
      expect(isReservedUsername("AdMin")).toBe(true);
      // Real names are fine
      expect(isReservedUsername("alice")).toBe(false);
    });

    it("isValidPubkey accepts a 32-byte base64 string", () => {
      expect(isValidPubkey(PUBKEY)).toBe(true);
      expect(isValidPubkey("")).toBe(false);
      expect(isValidPubkey("not base64!")).toBe(false);
      expect(isValidPubkey(Buffer.alloc(31).toString("base64"))).toBe(false);
      expect(isValidPubkey(Buffer.alloc(33).toString("base64"))).toBe(false);
    });
  });

  describe("parseClaimBody", () => {
    it("accepts a well-formed body", () => {
      const r = parseClaimBody({
        username: "alice",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: "0xdeadbeef",
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.username).toBe("alice");
    });

    it("lowercases the username", () => {
      const r = parseClaimBody({
        username: "ALICE",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: "0xdeadbeef",
      });
      // username regex rejects uppercase, so this should fail validation
      expect(r.ok).toBe(false);
    });

    it("rejects reserved names with a clear error", () => {
      const r = parseClaimBody({
        username: "admin",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: "0xdeadbeef",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/reserved/);
    });

    it("rejects malformed pubkeys", () => {
      const r = parseClaimBody({
        username: "alice",
        wallet: WALLET,
        pubkey: "nope",
        wallet_signature: "0xdeadbeef",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/pubkey/);
    });
  });

  describe("POST /passport/username", () => {
    it("validation errors return 400 before the paywall", async () => {
      const app = freshApp();
      const res = await request(app).post("/passport/username").send({
        username: "x", // too short
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: "0xdeadbeef",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/username/);
    });

    it("rejects a claim with an invalid wallet signature", async () => {
      const app = freshApp();
      const res = await request(app).post("/passport/username").send({
        username: "alice",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: "0x" + "00".repeat(65),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/);
    });

    it("accepts a claim with a valid wallet signature", async () => {
      const app = freshApp();
      const sig = await signClaimWithWallet("alice", PUBKEY);
      const res = await request(app).post("/passport/username").send({
        username: "alice",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: sig,
      });
      expect(res.status).toBe(201);
      expect(res.body.username.username).toBe("alice");
      expect(res.body.username.wallet).toBe(WALLET.toLowerCase());
      expect(res.body.username.pubkey).toBe(PUBKEY);
      expect(typeof res.body.attestation.signature).toBe("string");
    });

    it("returns 409 on a second claim of the same name", async () => {
      const app = freshApp();
      const sig = await signClaimWithWallet("bob1", PUBKEY);
      const first = await request(app).post("/passport/username").send({
        username: "bob1",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: sig,
      });
      expect(first.status).toBe(201);
      const second = await request(app).post("/passport/username").send({
        username: "bob1",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: sig,
      });
      expect(second.status).toBe(409);
    });

    it("rejects claim where signature was made for a different pubkey", async () => {
      const app = freshApp();
      const sigForPubkey1 = await signClaimWithWallet("carol", PUBKEY);
      const res = await request(app).post("/passport/username").send({
        username: "carol",
        wallet: WALLET,
        pubkey: PUBKEY_2,
        wallet_signature: sigForPubkey1,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /passport/username/:name", () => {
    it("returns 404 for unclaimed names", async () => {
      const app = freshApp();
      const res = await request(app).get("/passport/username/nobody");
      expect(res.status).toBe(404);
    });

    it("returns the claim for a known name", async () => {
      const app = freshApp();
      const sig = await signClaimWithWallet("dave", PUBKEY);
      await request(app).post("/passport/username").send({
        username: "dave",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: sig,
      });
      const res = await request(app).get("/passport/username/dave");
      expect(res.status).toBe(200);
      expect(res.body.username.pubkey).toBe(PUBKEY);
    });

    it("is case-insensitive on lookup", async () => {
      const app = freshApp();
      const sig = await signClaimWithWallet("eve1", PUBKEY);
      await request(app).post("/passport/username").send({
        username: "eve1",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: sig,
      });
      const res = await request(app).get("/passport/username/EVE1");
      expect(res.status).toBe(200);
      expect(res.body.username.username).toBe("eve1");
    });
  });

  describe("GET /passport/username/by-wallet/:wallet", () => {
    it("rejects malformed wallets", async () => {
      const app = freshApp();
      const res = await request(app).get("/passport/username/by-wallet/notawallet");
      expect(res.status).toBe(400);
    });

    it("returns all usernames for a wallet", async () => {
      const app = freshApp();
      for (const name of ["frank", "frank_alt"]) {
        const sig = await signClaimWithWallet(name, PUBKEY);
        await request(app).post("/passport/username").send({
          username: name,
          wallet: WALLET,
          pubkey: PUBKEY,
          wallet_signature: sig,
        });
      }
      const res = await request(app).get(`/passport/username/by-wallet/${WALLET}`);
      expect(res.status).toBe(200);
      const names = (res.body.usernames as { username: string }[]).map((u) => u.username);
      expect(names.sort()).toEqual(["frank", "frank_alt"]);
    });
  });

  describe("rotate", () => {
    it("currently returns 501 (reserved for v2)", async () => {
      const app = freshApp();
      const sig = await signClaimWithWallet("grace", PUBKEY);
      await request(app).post("/passport/username").send({
        username: "grace",
        wallet: WALLET,
        pubkey: PUBKEY,
        wallet_signature: sig,
      });
      const res = await request(app)
        .post("/passport/username/grace/rotate")
        .send({ new_pubkey: PUBKEY_2, signature: "ignored-for-now" });
      expect(res.status).toBe(501);
    });

    it("_rotateForTesting writes the new pubkey via the table path", () => {
      // Drive the table-update path that v2 will gate on a real signature.
      const sig = ""; // bypass network setup
      void sig;
      const placeholder = passportProduct.help; // keep passportProduct import live
      void placeholder;
      // Insert directly via the username insertion path, then rotate.
      const app = freshApp();
      return signClaimWithWallet("henry", PUBKEY).then(async (s) => {
        await request(app).post("/passport/username").send({
          username: "henry",
          wallet: WALLET,
          pubkey: PUBKEY,
          wallet_signature: s,
        });
        const before = getUsername("henry");
        expect(before?.pubkey).toBe(PUBKEY);
        const after = _rotateForTesting("henry", PUBKEY_2);
        expect(after?.pubkey).toBe(PUBKEY_2);
        expect(after?.rotated_at).not.toBeNull();
      });
    });
  });
});
