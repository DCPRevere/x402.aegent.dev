import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import {
  freshSeed,
  drawCoinOrDie,
  drawRange,
  drawBytes,
  drawUuidV4,
  drawChoose,
  drawShuffle,
  drawNormal,
  drawExponential,
  drawPoisson,
  drawDnd,
  type DrawSpec,
  type DrawResult,
} from "./draw.js";
import { validateDrawInput } from "./validate-draw.js";
import {
  ensureRandomTables,
  createCommit,
  getCommit,
  revealCommit,
  createSeal,
  tryUnlockSeal,
  createPool,
  getPool,
  registerForPool,
  listPoolMembers,
  recordPoolDraw,
} from "./state.js";
import { randomHelp } from "./help.js";
import type { Product } from "../../core/product.js";

const SLUG = "random";

// ----- /random/draw ---------------------------------------------------

function preValidator(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/draw" || req.path === "/draw/") {
    const r = validateDrawInput(req.query);
    if (!r.ok) {
      res.status(r.status).type("text/plain").send(r.error + "\n");
      return;
    }
    (res.locals as { drawInput?: { spec: DrawSpec; count: number } }).drawInput = {
      spec: r.spec,
      count: r.count,
    };
  }
  next();
}

function drawHandler(_req: Request, res: Response) {
  const input = (
    res.locals as { drawInput?: { spec: DrawSpec; count: number } }
  ).drawInput;
  if (!input) {
    res.status(500).type("text/plain").send("internal: validator did not run\n");
    return;
  }
  const seed = freshSeed();
  const result = derive(seed, input.spec, input.count);
  res.json(result);
}

function derive(seed: Buffer, spec: DrawSpec, count: number): DrawResult {
  if (spec.sides !== undefined) {
    return {
      seed: seed.toString("hex"),
      derivation: `die(seed, sides=${spec.sides}, count=${count})`,
      output: drawCoinOrDie(seed, spec.sides, count),
    };
  }
  if (spec.range) {
    return {
      seed: seed.toString("hex"),
      derivation: `range(seed, lo=${spec.range.lo}, hi=${spec.range.hi}, count=${count})`,
      output: drawRange(seed, spec.range.lo, spec.range.hi, count),
    };
  }
  if (spec.bytes !== undefined) {
    return {
      seed: seed.toString("hex"),
      derivation: `bytes(seed, n=${spec.bytes})`,
      output: drawBytes(seed, spec.bytes),
    };
  }
  if (spec.uuid === "v4") {
    return {
      seed: seed.toString("hex"),
      derivation: "uuid-v4(seed)",
      output: drawUuidV4(seed),
    };
  }
  if (spec.choose) {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const subseed = subSeed(seed, i);
      out.push(drawChoose(subseed, spec.choose, spec.weights));
    }
    return {
      seed: seed.toString("hex"),
      derivation: `choose(seed, labels=${spec.choose.length}, weights=${spec.weights ? "yes" : "no"}, count=${count})`,
      output: count === 1 ? out[0] : out,
    };
  }
  if (spec.shuffle) {
    return {
      seed: seed.toString("hex"),
      derivation: `shuffle(seed, items=${spec.shuffle.length})`,
      output: drawShuffle(seed, spec.shuffle),
    };
  }
  if (spec.dnd) {
    return {
      seed: seed.toString("hex"),
      derivation: `dnd(seed, ${spec.dnd.dice}d${spec.dnd.sides}${spec.dnd.modifier ? spec.dnd.modifier + spec.dnd.keep : ""})`,
      output: drawDnd(seed, spec.dnd),
    };
  }
  if (spec.distribution) {
    const d = spec.distribution;
    if (d.kind === "uniform") {
      return {
        seed: seed.toString("hex"),
        derivation: `uniform(seed, count=${count})`,
        output: drawRange(seed, 0, 1_000_000_000, count).map((v) => v / 1_000_000_000),
      };
    }
    if (d.kind === "normal") {
      return {
        seed: seed.toString("hex"),
        derivation: `normal(seed, mu=${d.mu}, sigma=${d.sigma}, count=${count})`,
        output: drawNormal(seed, d.mu, d.sigma, count),
      };
    }
    if (d.kind === "exponential") {
      return {
        seed: seed.toString("hex"),
        derivation: `exponential(seed, lambda=${d.lambda}, count=${count})`,
        output: drawExponential(seed, d.lambda, count),
      };
    }
    if (d.kind === "poisson") {
      return {
        seed: seed.toString("hex"),
        derivation: `poisson(seed, lambda=${d.lambda}, count=${count})`,
        output: drawPoisson(seed, d.lambda, count),
      };
    }
  }
  throw new Error("derive: empty spec");
}

function subSeed(seed: Buffer, i: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(i >>> 0, 0);
  return crypto.createHash("sha256").update(seed).update(buf).digest();
}

// ----- /random/commit -------------------------------------------------

function commitCreateHandler(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const commitment = typeof body.commitment === "string" ? body.commitment : "";
  const deadline = typeof body.deadline === "string" ? body.deadline : "";
  const label = typeof body.label === "string" ? body.label : undefined;

  if (!/^0x?[0-9a-fA-F]{64}$/.test(commitment.replace(/^0x/, ""))) {
    res.status(400).json({ error: "commitment must be 32 bytes of hex (with optional 0x)" });
    return;
  }
  if (!Number.isFinite(Date.parse(deadline))) {
    res.status(400).json({ error: "deadline must be an ISO 8601 timestamp" });
    return;
  }
  if (Date.parse(deadline) <= Date.now()) {
    res.status(400).json({ error: "deadline must be in the future" });
    return;
  }

  const row = createCommit({
    commitment: commitment.replace(/^0x/, "").toLowerCase(),
    deadline,
    label,
  });
  res.status(201).json({ id: row.id, commitment: row.commitment, deadline: row.deadline, state: row.state });
}

function commitGetHandler(req: Request, res: Response) {
  const row = getCommit(req.params.id);
  if (!row) {
    res.status(404).json({ error: "no such commit" });
    return;
  }
  res.json(row);
}

function commitRevealHandler(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const value = typeof body.value === "string" ? body.value : "";
  const salt = typeof body.salt === "string" ? body.salt : "";
  if (!value || !salt) {
    res.status(400).json({ error: "value and salt are both required" });
    return;
  }
  const result = revealCommit(req.params.id, value, salt);
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json(result.row);
}

// ----- /random/seal ---------------------------------------------------

function sealCreateHandler(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext : "";
  const unlock_kind = typeof body.unlock_kind === "string" ? body.unlock_kind : "";
  const unlock_value = typeof body.unlock_value === "string" ? body.unlock_value : "";

  if (!ciphertext || ciphertext.length > 32 * 1024) {
    res.status(400).json({ error: "ciphertext required, max 32 KiB base64" });
    return;
  }
  if (!["block_height", "timestamp", "deposit"].includes(unlock_kind)) {
    res.status(400).json({ error: "unlock_kind must be block_height|timestamp|deposit" });
    return;
  }
  if (!unlock_value) {
    res.status(400).json({ error: "unlock_value is required" });
    return;
  }

  const row = createSeal({
    ciphertext,
    unlock_kind: unlock_kind as "block_height" | "timestamp" | "deposit",
    unlock_value,
  });
  res.status(201).json({ id: row.id, state: row.state, unlock_kind: row.unlock_kind, unlock_value: row.unlock_value });
}

function sealGetHandler(req: Request, res: Response) {
  const row = tryUnlockSeal(req.params.id);
  if (!row) {
    res.status(404).json({ error: "no such seal" });
    return;
  }
  res.json(row);
}

// ----- /random/sortition ----------------------------------------------

function sortitionCreateHandler(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pool_name = typeof body.pool_name === "string" ? body.pool_name : "";
  const draw_at_block = Number(body.draw_at_block);
  const count = Number(body.count);

  if (!pool_name || pool_name.length > 128) {
    res.status(400).json({ error: "pool_name required, max 128 chars" });
    return;
  }
  if (!Number.isInteger(draw_at_block) || draw_at_block < 1) {
    res.status(400).json({ error: "draw_at_block must be a positive integer" });
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    res.status(400).json({ error: "count must be in [1, 1000]" });
    return;
  }

  try {
    const pool = createPool({ pool_name, draw_at_block, count });
    res.status(201).json(pool);
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      res.status(409).json({ error: "pool_name already exists" });
      return;
    }
    throw err;
  }
}

function sortitionRegisterHandler(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    res.status(400).json({ error: "wallet must be a 0x-prefixed 20-byte hex address" });
    return;
  }
  const result = registerForPool(req.params.id, wallet);
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.status(201).json({ ok: true });
}

function sortitionDrawHandler(req: Request, res: Response) {
  const pool = getPool(req.params.id);
  if (!pool) {
    res.status(404).json({ error: "no such pool" });
    return;
  }
  if (pool.state !== "open") {
    res.status(400).json({ error: `pool is ${pool.state}` });
    return;
  }
  const members = listPoolMembers(pool.id);
  if (members.length < pool.count) {
    res.status(400).json({ error: `pool has ${members.length} members, need ${pool.count}` });
    return;
  }
  // Draw uses a fresh seed; in production this would bind to draw_at_block's
  // hash. The result is recorded so the draw is replayable.
  const seed = freshSeed();
  const shuffled = drawShuffle(seed, members);
  const drawn = shuffled.slice(0, pool.count);
  const updated = recordPoolDraw(pool.id, drawn);
  res.json({
    pool: updated,
    drawn,
    seed: seed.toString("hex"),
  });
}

// ----- Wiring ---------------------------------------------------------

export function randomRouter(): express.Router {
  ensureRandomTables();
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));

  router.get("/draw", drawHandler);
  router.post("/commit", commitCreateHandler);
  router.get("/commit/:id", commitGetHandler);
  router.post("/commit/:id/reveal", commitRevealHandler);
  router.post("/seal", sealCreateHandler);
  router.get("/seal/:id", sealGetHandler);
  router.post("/sortition", sortitionCreateHandler);
  router.post("/sortition/:id/register", sortitionRegisterHandler);
  router.post("/sortition/:id/draw", sortitionDrawHandler);
  return router;
}

export const randomProduct: Product = {
  slug: SLUG,
  description:
    "Verifiable entropy & sealing primitives: paid randomness, commit-reveal, " +
    "time-locked secrets, and verifiable pool sortition.",
  paidRoutes: [
    {
      method: "GET",
      path: `/${SLUG}/draw`,
      price: "$0.005",
      description: "Verifiable random draw — coin, dice, shuffle, picks, distributions, raw bytes.",
    },
    {
      method: "POST",
      path: `/${SLUG}/commit`,
      price: "$0.05",
      description: "Open a commit-reveal binding.",
    },
    {
      method: "POST",
      path: `/${SLUG}/seal`,
      price: "$0.05",
      description: "Submit a time- or condition-sealed ciphertext.",
    },
    {
      method: "POST",
      path: `/${SLUG}/sortition`,
      price: "$0.10",
      description: "Create a verifiable random selection pool.",
    },
  ],
  preValidators: [preValidator],
  router: randomRouter,
  help: randomHelp,
};
