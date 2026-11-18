/*
 * #4453 milestone 7c TESTER (adversarial) — the design-pass claim in
 * gateway-nonces under concurrency and failure. Harness mirrors the
 * implementor's (designPass.issue4453.test.ts); the attacks are different:
 * an in-flight pass vs a duplicate, a failing pass releasing only its OWN
 * claim, a claim that could not be made never deleting anyone's claim, a
 * failing release never masking the pass's error, and Payload's REAL
 * unique-violation shape (handleUpsertError) mapping to ALREADY_RUN.
 * Originally from milestone 7 — Ari's design pass in Studio (SC-A1, SC-A2, D6, D7):
 * the flag gates it, Ari is refused an "avoid" style (STYLE_DOES_NOT_FIT),
 * the look-alike check only warns, it runs once per draft, and everything it
 * writes goes to the draft through composer v2.
 *
 * invariant: I-SITES-ARI-NEVER-PICKS-AVOID (declared in formats.issue4453.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpsertError } from "../../node_modules/@payloadcms/drizzle/dist/upsertRow/handleUpsertError.js"; // not in the package exports: the real file, by path

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

import { designPassClaimKey, isClaimDuplicate, runDesignPassAction } from "./designPass";
import { ARI_REFUSAL_CODES } from "./ariSiteActions";
import { parseSignedDesignPass } from "./designPassInputs";
import type { AriActionContext } from "./ariSiteActions";
import { designFingerprint } from "../contracts/generated/formats.ts";

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
let nonces: Set<string>;
let claimFailure: Error | null = null;
let clock: number;
const tick = (): string => new Date(Date.UTC(2026, 10, 16, 12, 0, clock++)).toISOString();

function ctx(designPass: ReturnType<typeof signed> | null): AriActionContext {
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: { and?: Array<Record<string, { greater_than?: string }>> } }) => {
      if (collection === "publication-jobs") return { docs: publications.slice(-1) };
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
        nonces.add(nonce);
        return { id: nonce };
      }
      writes.push({ op: "create", collection, data });
      return { id: `new-${writes.length}` };
    }),
    delete: vi.fn(async ({ collection, where }: { collection: string; where: { nonce: { equals: string } } }) => {
      if (collection === "gateway-nonces") nonces.delete(where.nonce.equals);
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
  nonces = new Set();
  claimFailure = null;
  clock = 0;
});


const deferred = () => { let resolve!: (v: string) => void; let reject!: (e: Error) => void; const promise = new Promise<string>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const deleteCalls = (c: AriActionContext) => ((c.req.payload as unknown as { delete: ReturnType<typeof vi.fn> }).delete.mock.calls);

describe("#4453 m7c tester — design-pass claim under concurrency and failure", () => {
  it("an in-flight pass blocks a second pass (ALREADY_RUN) and the loser never releases the winner's claim", async () => {
    const gate = deferred();
    const writeWorkLog = deps.writeWorkLog as unknown as ReturnType<typeof vi.fn>;
    writeWorkLog.mockImplementationOnce(async () => gate.promise);
    const a = ctx(signed());
    const first = runDesignPassAction("propose_site_design_pass", { design_key: "terra", why: "Fits.", cites: [] }, a, deps);
    await vi.waitFor(() => expect(nonces.size).toBe(1));
    const b = ctx(signed());
    await expect(runDesignPassAction("propose_site_design_pass", { design_key: "journal", why: "Fits.", cites: [] }, b, deps)).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
    expect(deleteCalls(b)).toHaveLength(0);
    expect(nonces.size).toBe(1); // the winner still holds it
    // The winner then FAILS: it releases its own claim, exactly once, by its own key.
    gate.reject(new Error("work log down"));
    await expect(first).rejects.toThrow("work log down");
    expect(deleteCalls(a)).toHaveLength(1);
    expect(deleteCalls(a)[0]![0].where.nonce.equals).toBe(designPassClaimKey("t1", null));
    expect(nonces.size).toBe(0);
    await expect(pass("journal")).resolves.toMatchObject({ design: "journal" });
  });

  it("a claim that could not be made (TRY_AGAIN) deletes nothing — another pass's claim survives", async () => {
    nonces.add(designPassClaimKey("t1", null)); // held by an in-flight pass elsewhere
    claimFailure = new Error("Connection terminated unexpectedly");
    const c = ctx(signed());
    await expect(runDesignPassAction("propose_site_design_pass", { design_key: "terra", why: "Fits.", cites: [] }, c, deps)).rejects.toThrow("DESIGN_PASS_TRY_AGAIN");
    expect(deleteCalls(c)).toHaveLength(0);
    expect(nonces.has(designPassClaimKey("t1", null))).toBe(true);
    expect(writes).toEqual([]);
  });

  it("every write after the claim releases it: the settings write and the composition write", async () => {
    for (const failing of ["site-settings", "pages"]) {
      nonces.clear();
      const c = ctx(signed());
      const payload = c.req.payload as unknown as { update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
      const fail = async ({ collection }: { collection: string }) => { if (collection === failing) throw new Error(`${failing} down`); return { id: "x", docs: [] }; };
      if (failing === "site-settings") payload.update.mockImplementation(fail);
      else { const original = payload.create.getMockImplementation()!; payload.create.mockImplementation(async (args: { collection: string }) => (args.collection === "pages" ? fail(args) : (original as (input: unknown) => unknown)(args))); }
      await expect(runDesignPassAction("propose_site_design_pass", { design_key: "terra", why: "Fits.", cites: [] }, c, deps)).rejects.toThrow(`${failing} down`);
      expect(nonces.size, failing).toBe(0);
    }
  });

  it("a release that itself fails never masks the pass's own error (the claim then stays: documented residual)", async () => {
    const c = ctx(signed());
    (c.req.payload as unknown as { delete: ReturnType<typeof vi.fn> }).delete.mockImplementation(async () => { throw new Error("delete refused"); });
    (deps.writeWorkLog as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error("work log down"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runDesignPassAction("propose_site_design_pass", { design_key: "terra", why: "Fits.", cites: [] }, c, deps)).rejects.toThrow("work log down");
    expect(spy.mock.calls.some((call) => String(call[0]).includes("could not release"))).toBe(true);
    spy.mockRestore();
  });

  it("Payload's REAL unique-violation error (handleUpsertError on a Postgres 23505) reads as ALREADY_RUN; other drizzle errors do not", () => {
    const adapter = { fieldConstraints: {} } as never;
    const pg23505 = Object.assign(new Error("duplicate key value violates unique constraint \"gateway_nonces_nonce_idx\""), {
      code: "23505", constraint: "gateway_nonces_nonce_idx", detail: "Key (nonce)=(design-pass:abc) already exists.",
    });
    let thrown: unknown;
    try { handleUpsertError({ adapter, collectionSlug: "gateway-nonces", error: new Error("insert failed", { cause: pg23505 }), tableName: "gateway_nonces" }); } catch (error) { thrown = error; }
    expect(isClaimDuplicate(thrown)).toBe(true);
    // A non-unique driver failure is rethrown unchanged and must be retryable, not "already run".
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    try { handleUpsertError({ adapter, collectionSlug: "gateway-nonces", error: timeout, tableName: "gateway_nonces" }); } catch (error) { thrown = error; }
    expect(isClaimDuplicate(thrown)).toBe(false);
  });

  it("the claim key never collides across brands or drafts, and fits the 64-char column", () => {
    const keys = new Set<string>();
    for (const tenant of ["t1", "t2", "t1|x"]) for (const since of [null, "2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z"]) keys.add(designPassClaimKey(tenant, since));
    expect(keys.size).toBe(9);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(64);
  });
});
