import crypto from "node:crypto";
import { runMigrations, getDb } from "../../core/persist.js";

/** Sqlite migrations + helpers for /passport. */

export const PASSPORT_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS passport_bindings (
     id            TEXT PRIMARY KEY,
     wallet        TEXT NOT NULL,
     anchor_kind   TEXT NOT NULL CHECK (anchor_kind IN ('ens','domain','gist')),
     anchor_value  TEXT NOT NULL,
     verified      INTEGER NOT NULL DEFAULT 0,
     issued_at     TEXT NOT NULL,
     expires_at    TEXT NOT NULL,
     signature     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS passport_bindings_wallet ON passport_bindings(wallet, expires_at)`,
  `CREATE TABLE IF NOT EXISTS passport_captcha_challenges (
     id           TEXT PRIMARY KEY,
     wallet       TEXT NOT NULL,
     difficulty   INTEGER NOT NULL,
     nonce        TEXT NOT NULL,
     issued_at    TEXT NOT NULL,
     expires_at   TEXT NOT NULL,
     state        TEXT NOT NULL CHECK (state IN ('open','solved','expired'))
   )`,
  `CREATE INDEX IF NOT EXISTS passport_captcha_wallet ON passport_captcha_challenges(wallet, state)`,
  `CREATE TABLE IF NOT EXISTS passport_passes (
     id          TEXT PRIMARY KEY,
     wallet      TEXT NOT NULL,
     issued_at   TEXT NOT NULL,
     expires_at  TEXT NOT NULL,
     signature   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS passport_passes_wallet ON passport_passes(wallet, expires_at)`,
  `CREATE TABLE IF NOT EXISTS passport_usernames (
     username    TEXT PRIMARY KEY COLLATE NOCASE,
     wallet      TEXT NOT NULL,
     pubkey      TEXT NOT NULL,
     claimed_at  TEXT NOT NULL,
     rotated_at  TEXT,
     signature   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS passport_usernames_wallet ON passport_usernames(wallet)`,
];

export function ensurePassportTables(): void {
  runMigrations(PASSPORT_MIGRATIONS);
}

// ----- Bindings -------------------------------------------------------

export interface BindingRow {
  id: string;
  wallet: string;
  anchor_kind: "ens" | "domain" | "gist";
  anchor_value: string;
  verified: 0 | 1;
  issued_at: string;
  expires_at: string;
  signature: string;
}

export function insertBinding(row: Omit<BindingRow, "id">): BindingRow {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO passport_bindings (id, wallet, anchor_kind, anchor_value, verified, issued_at, expires_at, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.wallet.toLowerCase(),
      row.anchor_kind,
      row.anchor_value,
      row.verified,
      row.issued_at,
      row.expires_at,
      row.signature,
    );
  return { id, ...row, wallet: row.wallet.toLowerCase() };
}

export function listBindings(wallet: string): BindingRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM passport_bindings WHERE wallet = ? AND expires_at > ? ORDER BY issued_at DESC`,
    )
    .all(wallet.toLowerCase(), new Date().toISOString()) as BindingRow[];
}

// ----- Captcha challenges ---------------------------------------------

export interface ChallengeRow {
  id: string;
  wallet: string;
  difficulty: number;
  nonce: string;
  issued_at: string;
  expires_at: string;
  state: "open" | "solved" | "expired";
}

export function insertChallenge(row: Omit<ChallengeRow, "id" | "state">): ChallengeRow {
  const id = crypto.randomUUID();
  const state: "open" = "open";
  getDb()
    .prepare(
      `INSERT INTO passport_captcha_challenges (id, wallet, difficulty, nonce, issued_at, expires_at, state)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    )
    .run(id, row.wallet.toLowerCase(), row.difficulty, row.nonce, row.issued_at, row.expires_at);
  return { id, ...row, wallet: row.wallet.toLowerCase(), state };
}

export function getChallenge(id: string): ChallengeRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM passport_captcha_challenges WHERE id = ?`)
      .get(id) as ChallengeRow | undefined) ?? null
  );
}

export function markChallengeSolved(id: string): void {
  getDb()
    .prepare(`UPDATE passport_captcha_challenges SET state = 'solved' WHERE id = ?`)
    .run(id);
}

// ----- Passes ---------------------------------------------------------

export interface PassRow {
  id: string;
  wallet: string;
  issued_at: string;
  expires_at: string;
  signature: string;
}

export function insertPass(row: Omit<PassRow, "id">): PassRow {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO passport_passes (id, wallet, issued_at, expires_at, signature)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, row.wallet.toLowerCase(), row.issued_at, row.expires_at, row.signature);
  return { id, ...row, wallet: row.wallet.toLowerCase() };
}

export function listPasses(wallet: string): PassRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM passport_passes WHERE wallet = ? AND expires_at > ? ORDER BY issued_at DESC`,
    )
    .all(wallet.toLowerCase(), new Date().toISOString()) as PassRow[];
}

// ----- Usernames ------------------------------------------------------

export interface UsernameRow {
  username: string;
  wallet: string;
  pubkey: string;
  claimed_at: string;
  rotated_at: string | null;
  signature: string;
}

export function insertUsername(row: Omit<UsernameRow, "rotated_at">): UsernameRow {
  getDb()
    .prepare(
      `INSERT INTO passport_usernames (username, wallet, pubkey, claimed_at, signature)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      row.username.toLowerCase(),
      row.wallet.toLowerCase(),
      row.pubkey,
      row.claimed_at,
      row.signature,
    );
  return { ...row, username: row.username.toLowerCase(), wallet: row.wallet.toLowerCase(), rotated_at: null };
}

export function getUsername(username: string): UsernameRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM passport_usernames WHERE username = ? COLLATE NOCASE`)
      .get(username.toLowerCase()) as UsernameRow | undefined) ?? null
  );
}

export function listUsernamesByWallet(wallet: string): UsernameRow[] {
  return getDb()
    .prepare(`SELECT * FROM passport_usernames WHERE wallet = ? ORDER BY claimed_at ASC`)
    .all(wallet.toLowerCase()) as UsernameRow[];
}

export function rotateUsernamePubkey(
  username: string,
  newPubkey: string,
  rotated_at: string,
  signature: string,
): UsernameRow | null {
  const result = getDb()
    .prepare(
      `UPDATE passport_usernames SET pubkey = ?, rotated_at = ?, signature = ?
        WHERE username = ? COLLATE NOCASE`,
    )
    .run(newPubkey, rotated_at, signature, username.toLowerCase());
  if (result.changes === 0) return null;
  return getUsername(username);
}
