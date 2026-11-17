/*
 * #4453 milestone 7 TESTER (adversarial) — Ari can never land a never-chosen
 * (avoid) style/format pair, from any format, under any spelling, and a
 * refused pass writes nothing. Harness mirrors the implementor's suite;
 * the flag gates it, Ari is refused an "avoid" style (STYLE_DOES_NOT_FIT),
 * the look-alike check only warns, it runs once per draft, and everything it
 * writes goes to the draft through composer v2.
 *
 * invariant: I-SITES-ARI-NEVER-PICKS-AVOID (declared in formats.ts).
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

import { runDesignPassAction } from "./designPass";
import { parseSignedDesignPass } from "./designPassInputs";
import type { AriActionContext } from "./ariSiteActions";
import { FORMAT_KEYS, STYLE_KEYS, styleFitLevel, type FormatKey } from "../contracts/generated/formats.ts";

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
let jobs: Array<{ tenant: string; status: string; updatedAt: string }>;
let clock: number;
const tick = (): string => new Date(Date.UTC(2026, 10, 16, 12, 0, clock++)).toISOString();

type Clause = Record<string, { equals?: unknown; greater_than?: string }>;
/** Honours the `where` Studio actually sends (tenant, status, tool, createdAt > x), so a dropped filter fails a test. */
function matches(doc: Record<string, unknown>, where: { and?: Clause[] } | undefined): boolean {
  return (where?.and ?? []).every((clause) => Object.entries(clause).every(([field, cond]) => {
    if (cond.equals !== undefined) return doc[field] === cond.equals;
    if (cond.greater_than !== undefined) return String(doc[field]) > cond.greater_than;
    return true;
  }));
}

function ctx(designPass: ReturnType<typeof signed> | null, tenantId = "t1"): AriActionContext {
  const payload = {
    find: vi.fn(async ({ collection, where, sort }: { collection: string; where?: { and?: Clause[] }; sort?: string }) => {
      if (collection === "publication-jobs") {
        const hits = jobs.filter((job) => matches(job, where));
        if (sort === "-updatedAt") hits.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return { docs: hits.slice(0, 1) };
      }
      if (collection === "work-log") return { docs: workLog.filter((entry) => matches(entry, where)) };
      if (collection === "navigation") return { docs: [{ id: "nav", items: [] }] };
      return { docs: [] };
    }),
    create: vi.fn(async ({ collection, data }: { collection: string; data: unknown }) => {
      writes.push({ op: "create", collection, data });
      return { id: `new-${writes.length}` };
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
    tenantId,
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
  writeWorkLog: vi.fn(async (c: AriActionContext, entry: Record<string, unknown>) => {
    workLog.push({ ...entry, tenant: c.tenantId, createdAt: tick() });
    return "log-1";
  }),
  assertCites: vi.fn(async () => [{ kind: "mingla_record", record_id: id(1) }]),
  decisionOf: vi.fn((value: unknown) => String(value)),
} as unknown as Parameters<typeof runDesignPassAction>[3];

const pass = (design: string, designPass = signed(), tenantId = "t1") =>
  runDesignPassAction("propose_site_design_pass", { design_key: design, why: "It fits group trips.", cites: [] }, ctx(designPass, tenantId), deps);

beforeEach(() => {
  jobs = [];
  clock = 0;
  writes = [];
  workLog = [];
});

const PLAN_FOR: Record<string, string> = {
  trips: "trips", events: "events", experiences: "experiences",
  restaurants: "venue_food_drink", play: "venue_play", art: "venue_creative_arts", hotels: "venue_stay",
};

function signedFor(format: string, overrides: Record<string, unknown> = {}) {
  return signed({ plan: { offerings_selected: [PLAN_FOR[format]], venue_descriptor: null, story: { why: "Why we exist" } }, ...overrides });
}

describe("#4453 m7 tester — never an avoid pair from Ari", () => {
  it("every format x every avoid style is refused STYLE_DOES_NOT_FIT (or never offered) and writes nothing", async () => {
    let checked = 0;
    for (const format of FORMAT_KEYS) {
      for (const style of STYLE_KEYS) {
        if (styleFitLevel(format, style) !== "avoid") continue;
        writes = [];
        workLog = [];
        await expect(pass(style, signedFor(format))).rejects.toThrow(/STYLE_DOES_NOT_FIT|VALIDATION_FAILED/);
        expect(writes).toEqual([]);
        expect(workLog).toEqual([]);
        checked += 1;
      }
    }
    expect(checked).toBe(13);
  });

  it("spelling tricks never reach a write: case, whitespace, zero-width, non-style keys, prototype keys, non-strings", async () => {
    for (const design of ["Pulse", "PULSE", " pulse", "pulse ", "nocturne\u200b", "puls", "atelier", "__proto__", "constructor", "toString", "", null, undefined, ["pulse"], { key: "pulse" }, 7]) {
      await expect(pass(design as string)).rejects.toThrow(/VALIDATION_FAILED|STYLE_DOES_NOT_FIT/);
    }
    expect(writes).toEqual([]);
    expect(workLog).toEqual([]);
  });

  it("the brief never marks an avoid style pickable, for any format, with or without taken looks", async () => {
    for (const format of FORMAT_KEYS) {
      const brief = await runDesignPassAction("get_site_design_brief", {}, ctx(signedFor(format)), deps) as { format: string; styles: Array<{ style: string; fit: string; pickable_by_ari: boolean }> };
      for (const entry of brief.styles) {
        expect(entry.pickable_by_ari).toBe(styleFitLevel(brief.format as FormatKey, entry.style as never) !== "avoid");
      }
    }
    expect(writes).toEqual([]);
  });

  it("a two-format plan refuses every avoid style of its primary format", async () => {
    const mixed = signed({ plan: { offerings_selected: ["trips", "events"], venue_descriptor: null, story: { main_action: "buy_tickets" } } });
    const brief = await runDesignPassAction("get_site_design_brief", {}, ctx(mixed), deps) as { format: FormatKey };
    for (const style of STYLE_KEYS.filter((key) => styleFitLevel(brief.format, key) === "avoid")) {
      await expect(pass(style, mixed)).rejects.toThrow("STYLE_DOES_NOT_FIT");
    }
    expect(writes).toEqual([]);
  });

  it("propose_site_chrome cannot change the design (design args are ignored, nothing to change is refused)", async () => {
    await expect(runDesignPassAction("propose_site_chrome", { design: "pulse", design_key: "pulse", why: "x", cites: [] }, ctx(signedFor("trips")), deps)).rejects.toThrow("VALIDATION_FAILED");
    expect(writes).toEqual([]);
  });
});

describe("#4453 retest (P3-1) — one automatic pass per DRAFT, attacked", () => {
  it("a site that never published is one draft: the second pass is refused", async () => {
    await expect(pass("terra")).resolves.toMatchObject({ draft_only: true });
    await expect(pass("journal")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
  });

  it("a failed, ambiguous or still-running publish after the pass never opens a new draft", async () => {
    await pass("terra");
    for (const status of ["queued", "validating", "materializing", "probing", "failed", "ambiguous"]) {
      jobs.push({ tenant: "t1", status, updatedAt: tick() });
      await expect(pass("journal")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
    }
  });

  it("another tenant's publish never opens a pass here, and another tenant's pass never blocks one here", async () => {
    await pass("terra");
    jobs.push({ tenant: "t2", status: "published", updatedAt: tick() });
    await expect(pass("journal")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
    await expect(pass("journal", signed(), "t2")).resolves.toMatchObject({ draft_only: true });
  });

  it("a real publish opens exactly one more pass, then the new draft is closed again", async () => {
    await pass("terra");
    jobs.push({ tenant: "t1", status: "failed", updatedAt: tick() });
    jobs.push({ tenant: "t1", status: "published", updatedAt: tick() });
    jobs.push({ tenant: "t1", status: "failed", updatedAt: tick() });
    await expect(pass("journal")).resolves.toMatchObject({ design: "journal" });
    await expect(pass("voyage")).rejects.toThrow("DESIGN_PASS_ALREADY_RUN");
  });
});
