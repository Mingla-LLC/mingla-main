/*
 * #4453 milestone 7c RETEST — tester adversarial on the claim's 10-minute
 * expiry (harness copied from the implementor's claimExpiry suite; different
 * attacks): two passes racing to clear the same expired claim, the clock edge,
 * and a stale pass's release after its claim expired and was re-taken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tenantPages", () => ({ findAllTenantPages: vi.fn(async () => []) }));
vi.mock("./designPassInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./designPassInputs")>();
  return {
    ...actual,
    loadStudioRecords: vi.fn(async () => ({
      photos: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, alt: null })),
      destination_ids: ["d1"],
      stories: 2,
      confirmed_reviews: 3,
      ready_videos: 0,
      has_logo: false,
    })),
  };
});

import { DESIGN_PASS_CLAIM_TTL_MS, designPassClaimKey, runDesignPassAction } from "./designPass";
import { parseSignedDesignPass } from "./designPassInputs";
import type { AriActionContext } from "./ariSiteActions";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function signed(overrides: Record<string, unknown> = {}) {
  return parseSignedDesignPass({
    plan: { offerings_selected: ["trips"], venue_descriptor: null, story: { why: "We go further together" } },
    answers: { value_points: [{ title: "Two guides", sentence: "Two guides." }, { title: "Small", sentence: "Twelve people." }], faq: [{ question: "Fit?", answer: "Yes." }], process_steps: [], quick_facts: null },
    address: null,
    facts: { upcoming: { trip: 3, event: 0, experience: 0 }, ended: { trip: 4, event: 0, experience: 0 }, next_offering: { trip: id(1) }, bookable: { trip: 2 } },
    style_library: true,
    live_fingerprints: [],
    ...overrides,
  });
}

type Write = { op: string; collection: string; data?: unknown };
let writes: Write[];
let workLog: Array<Record<string, unknown>>;
let publications: Array<{ createdAt: string }>;
let nonces: Map<string, string>; // nonce -> expires_at
let claimFailure: Error | null = null;
let clock: number;
const tick = (): string => new Date(Date.UTC(2026, 10, 16, 12, 0, clock++)).toISOString();

function ctx(designPass: ReturnType<typeof signed> | null): AriActionContext {
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: { and?: Array<Record<string, { greater_than?: string }>> } }) => {
      if (collection === "publication-jobs") return { docs: publications.slice(-1) };
      if (collection === "gateway-nonces") {
        const nonce = (where as unknown as { nonce: { equals: string } }).nonce.equals;
        return { docs: nonces.has(nonce) ? [{ nonce, expires_at: nonces.get(nonce) }] : [] };
      }
      if (collection === "work-log") {
        const since = where?.and?.find((clause) => clause.createdAt)?.createdAt?.greater_than;
        return { docs: workLog.filter((entry) => !since || String(entry.createdAt) > since) };
      }
      if (collection === "navigation") return { docs: [{ id: "nav", items: [] }] };
      return { docs: [] };
    }),
    create: vi.fn(async ({ collection, data }: { collection: string; data: unknown }) => {
      if (collection === "gateway-nonces") {
        // The real column is UNIQUE: a second claim on the same key fails.
        const nonce = String((data as { nonce: string }).nonce);
        if (claimFailure) throw claimFailure;
        // Payload's shape for a Postgres 23505 on the nonce.
        if (nonces.has(nonce)) throw Object.assign(new Error("The following field is invalid: nonce"), { data: { errors: [{ path: "nonce", message: "Value must be unique" }] } });
        nonces.set(nonce, String((data as { expires_at: string }).expires_at));
        return { id: nonce };
      }
      writes.push({ op: "create", collection, data });
      return { id: `new-${writes.length}` };
    }),
    delete: vi.fn(async ({ collection, where }: { collection: string; where: { nonce: { equals: string }; expires_at?: { less_than: string } } }) => {
      if (collection === "gateway-nonces") {
        const nonce = where.nonce.equals;
        // The real delete re-checks the expiry in its WHERE clause.
        if (!where.expires_at || String(nonces.get(nonce)) < where.expires_at.less_than) nonces.delete(nonce);
      }
      return { docs: [] };
    }),
    update: vi.fn(async ({ collection, data }: { collection: string; data: unknown }) => {
      writes.push({ op: "update", collection, data });
      return {};
    }),
  };
  const req = { payload } as unknown as AriActionContext["req"];
  return {
    req,
    scoped: req,
    tenantId: "t1",
    siteId: id(90),
    brandId: id(91),
    userId: id(92),
    rank: 50,
    evidence: { brand: { id: id(91), name: "Young and Stamped", description: "Go far.\n\nSmall-group trips.", city: "London", contact_email: "hi@example.com" }, offerings: [] },
    designPass,
  };
}

const deps = {
  currentSettings: vi.fn(async () => ({ id: "settings", design: "voyage", tokens: {} })),
  writeWorkLog: vi.fn(async (_ctx: AriActionContext, entry: Record<string, unknown>) => {
    workLog.push({ ...entry, createdAt: tick() });
    return "log-1";
  }),
  assertCites: vi.fn(async () => [{ kind: "mingla_record", record_id: id(1) }]),
  decisionOf: vi.fn((value: unknown) => String(value)),
} as unknown as Parameters<typeof runDesignPassAction>[3];

const pass = (design: string, designPass = signed()) =>
  runDesignPassAction("propose_site_design_pass", { design_key: design, why: "It fits group trips.", cites: [] }, ctx(designPass), deps);

beforeEach(() => {
  writes = [];
  workLog = [];
  publications = [];
  nonces = new Map();
  claimFailure = null;
  clock = 0;
});

const key = designPassClaimKey("t1", null);
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const deferred = () => { let resolve!: (v: string) => void; let reject!: (e: Error) => void; const promise = new Promise<string>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const run = (c: AriActionContext, design = "terra") => runDesignPassAction("propose_site_design_pass", { design_key: design, why: "Fits.", cites: [] }, c, deps);

describe("#4453 m7c retest tester — the claim's expiry under races and the clock edge", () => {
  it("two passes clearing the same expired claim: the one that loses never deletes the winner's fresh claim", async () => {
    nonces.set(key, minutesFromNow(-1));
    const b = ctx(signed());
    const find = (b.req.payload as unknown as { find: ReturnType<typeof vi.fn> }).find;
    const original = find.getMockImplementation()!;
    let raced = false;
    find.mockImplementation(async (args: { collection: string }) => {
      const out = await (original as (input: unknown) => Promise<unknown>)(args);
      // Right after B reads the expired row, another pass clears it and takes a fresh claim.
      if (args.collection === "gateway-nonces" && !raced) { raced = true; nonces.set(key, minutesFromNow(10)); }
      return out;
    });
    const fresh = () => nonces.get(key);
    const before = minutesFromNow(10).slice(0, 15);
    await expect(run(b)).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
    expect(String(fresh()).slice(0, 15)).toBe(before);
    expect(writes).toEqual([]);
  });

  it("clock edge: a claim that expires a second from now still blocks and survives", async () => {
    const live = new Date(Date.now() + 1000).toISOString();
    nonces.set(key, live);
    await expect(pass("terra")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
    expect(nonces.get(key)).toBe(live);
  });

  /*
   * Residual (P3, needs a pass that runs longer than the 10-minute TTL): the
   * release deletes by nonce only, so a pass whose claim expired and was
   * re-taken by a second pass deletes the SECOND pass's claim when it fails.
   * Fix: release only the claim you made (delete where nonce = key AND
   * expires_at = the value you wrote, or by the created row id). Flip to `it`.
   */
  it.fails("a stale pass that fails after its claim expired and was re-taken does not release the new pass's claim", async () => {
    const gateA = deferred();
    (deps.writeWorkLog as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => gateA.promise);
    const first = run(ctx(signed()));
    await vi.waitFor(() => expect(nonces.has(key)).toBe(true));
    nonces.set(key, minutesFromNow(-1)); // A has now run past the TTL
    const gateB = deferred();
    (deps.writeWorkLog as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => gateB.promise);
    const second = run(ctx(signed()), "journal");
    await vi.waitFor(() => expect(Date.parse(String(nonces.get(key)))).toBeGreaterThan(Date.now()));
    gateA.reject(new Error("A failed late"));
    await expect(first).rejects.toThrow("A failed late");
    try {
      expect(nonces.has(key)).toBe(true); // B is still running: its claim must survive A's release
    } finally {
      gateB.resolve("log-b");
      await second;
    }
  });
});
