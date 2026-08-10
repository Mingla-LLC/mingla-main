/**
 * Issue #1735 — growthToolsService happy-path contract tests (G-4 / P-32).
 *
 * Fails-on-revert anchors: (1) the run body's subject-as-OBJECT discipline —
 * adding a client-composed `subject_ref` string to a WRITE body, or dropping
 * `lane:"app"`, turns this suite RED (P-41,
 * I-PROPOSED-1734-SUBJECT-REF-APP-LANE-ONLY); (2) the typed 409/429 error
 * mapping (watch_limit vs duplicate_competitor vs rate_limited scope:brand);
 * (3) the canonical-input hash stability.
 */

const mockInvoke = jest.fn<
  Promise<{ data: unknown; error: unknown }>,
  [string, { body: Record<string, unknown> }]
>();

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    functions: {
      invoke: (
        name: string,
        options: { body: Record<string, unknown> },
      ): Promise<{ data: unknown; error: unknown }> => mockInvoke(name, options),
    },
  },
}));

import {
  GrowthToolsAppError,
  addCompetitor,
  buildGraderInput,
  canonicalJsonStringify,
  listCompetitors,
  mintClientRef,
  readLatestBySubject,
  readRunByClientRef,
  removeCompetitor,
  runGrowthTool,
  searchPlaces,
  stableInputHash,
} from "../growthToolsService";

const ok = (data: unknown): { data: unknown; error: null } => ({
  data,
  error: null,
});

/** A FunctionsHttpError-shaped failure: `.context` is the raw Response. */
const httpError = (
  status: number,
  body: Record<string, unknown>,
): { data: null; error: { message: string; context: Response } } => ({
  data: null,
  error: {
    message: `Edge Function returned a non-2xx status code`,
    context: new Response(JSON.stringify(body), { status }),
  },
});

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("issue #1735 runGrowthTool (G-7 / P-41)", () => {
  it("sends lane:app + input + client_ref + subject OBJECT — never a subject_ref string", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({ run_id: "run-1", report: { scores: { grade: "B" } } }),
    );
    const result = await runGrowthTool(
      "venues",
      "brand-1",
      { name: "Bar Toto", city: "London", website: "https://bartoto.com" },
      { clientRef: "c0ffee00-0000-4000-8000-000000000001", subject: { type: "venue", id: "venue-1" } },
    );
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fn, options] = mockInvoke.mock.calls[0]!;
    expect(fn).toBe("growth-tools-run");
    expect(options.body).toEqual({
      action: "run",
      lane: "app",
      brand_id: "brand-1",
      input: { name: "Bar Toto", city: "London", website: "https://bartoto.com" },
      client_ref: "c0ffee00-0000-4000-8000-000000000001",
      subject: { type: "venue", id: "venue-1" },
    });
    // P-41 — the client NEVER composes the subject_ref string on a WRITE.
    expect(Object.keys(options.body)).not.toContain("subject_ref");
    expect(result).toEqual({
      runId: "run-1",
      report: { scores: { grade: "B" } },
      cached: false,
    });
  });

  it("surfaces the P-22 cached re-serve flag", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({ run_id: "run-1", report: {}, cached: true }),
    );
    const result = await runGrowthTool("venues", "brand-1", {});
    expect(result.cached).toBe(true);
  });

  it("routes the four tools to their engines", async () => {
    for (
      const [tool, fn] of [
        ["venues", "growth-tools-run"],
        ["events", "growth-tools-events"],
        ["trips", "growth-tools-trips"],
        ["experiences", "growth-tools-pricing"],
      ] as const
    ) {
      mockInvoke.mockResolvedValueOnce(ok({ run_id: "r", report: {} }));
      await runGrowthTool(tool, "brand-1", {});
      expect(mockInvoke.mock.calls.at(-1)![0]).toBe(fn);
    }
  });

  it("maps 429 to rate_limited with scope brand", async () => {
    mockInvoke.mockResolvedValueOnce(
      httpError(429, { error: "rate_limited", scope: "brand" }),
    );
    await expect(runGrowthTool("venues", "b", {})).rejects.toMatchObject({
      name: "GrowthToolsAppError",
      code: "rate_limited",
      scope: "brand",
      status: 429,
    });
  });

  it("maps 502 generation_failed with the additive reason", async () => {
    mockInvoke.mockResolvedValueOnce(
      httpError(502, { error: "generation_failed", reason: "timeout" }),
    );
    await expect(runGrowthTool("venues", "b", {})).rejects.toMatchObject({
      code: "generation_failed",
      reason: "timeout",
    });
  });

  it("maps a no-context failure to the network class (the P-27 poll trigger)", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });
    await expect(runGrowthTool("venues", "b", {})).rejects.toMatchObject({
      code: "network",
    });
  });
});

describe("issue #1735 readLatestBySubject (P-43 + OQ-U1)", () => {
  it("sends the P-43 body and maps status none", async () => {
    mockInvoke.mockResolvedValueOnce(ok({ status: "none" }));
    const result = await readLatestBySubject("brand-1", "venues", "venue:v1", false);
    expect(mockInvoke.mock.calls[0]![0]).toBe("growth-tools-report");
    expect(mockInvoke.mock.calls[0]![1].body).toEqual({
      lane: "app",
      brand_id: "brand-1",
      tool: "venues",
      subject_ref: "venue:v1",
      include_previous: false,
    });
    expect(result).toEqual({ status: "none" });
  });

  it("maps report_ready with previous + input (the OQ-U1 ruling)", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        status: "report_ready",
        run_id: "r2",
        created_at: "2026-08-09T10:00:00Z",
        report: { scores: { grade: "B" } },
        input: { name: "Bar Toto" },
        previous: {
          run_id: "r1",
          created_at: "2026-07-12T10:00:00Z",
          report: { scores: { grade: "C" } },
          input: { name: "Bar Toto" },
        },
      }),
    );
    const result = await readLatestBySubject(
      "brand-1",
      "venues",
      "competitor:c1",
      true,
    );
    expect(result).toEqual({
      status: "report_ready",
      latest: {
        runId: "r2",
        createdAt: "2026-08-09T10:00:00Z",
        report: { scores: { grade: "B" } },
        input: { name: "Bar Toto" },
      },
      previous: {
        runId: "r1",
        createdAt: "2026-07-12T10:00:00Z",
        report: { scores: { grade: "C" } },
        input: { name: "Bar Toto" },
      },
    });
  });
});

describe("issue #1735 client_ref resume read (P-27)", () => {
  it("maps created / failed / ready", async () => {
    mockInvoke.mockResolvedValueOnce(ok({ status: "created" }));
    await expect(readRunByClientRef("b", "ref")).resolves.toEqual({
      status: "created",
      reason: null,
    });
    mockInvoke.mockResolvedValueOnce(ok({ status: "failed", reason: "failed" }));
    await expect(readRunByClientRef("b", "ref")).resolves.toEqual({
      status: "failed",
      reason: "failed",
    });
    mockInvoke.mockResolvedValueOnce(
      ok({ status: "report_ready", run_id: "r", created_at: "t", report: {} }),
    );
    await expect(readRunByClientRef("b", "ref")).resolves.toEqual({
      status: "report_ready",
      runId: "r",
      createdAt: "t",
      report: {},
    });
  });
});

describe("issue #1735 watch CRUD + search (P-46)", () => {
  it("watch_list maps rows + latest badge fields", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        competitors: [
          {
            id: "c1",
            name: "Rival",
            city: "London",
            website: "https://rival.com",
            place_pool_id: null,
            created_at: "2026-08-01T00:00:00Z",
            latest: {
              run_id: "r9",
              grade: "B",
              overall: 74,
              checked_at: "2026-08-09T00:00:00Z",
              schema_version: 1,
            },
          },
          {
            id: "c2",
            name: "Fresh",
            city: null,
            website: "https://fresh.com",
            place_pool_id: "p1",
            created_at: "2026-08-02T00:00:00Z",
            latest: null,
          },
        ],
      }),
    );
    const rows = await listCompetitors("brand-1", "venue-1");
    expect(mockInvoke.mock.calls[0]![1].body).toEqual({
      action: "watch_list",
      lane: "app",
      brand_id: "brand-1",
      venue_listing_id: "venue-1",
    });
    expect(rows[0]!.latest).toEqual({
      runId: "r9",
      grade: "B",
      overall: 74,
      checkedAt: "2026-08-09T00:00:00Z",
      schemaVersion: 1,
    });
    expect(rows[1]!.latest).toBeNull();
  });

  it("watch_add maps the TWO distinct 409 codes", async () => {
    mockInvoke.mockResolvedValueOnce(
      httpError(409, { error: "duplicate_competitor" }),
    );
    await expect(
      addCompetitor("b", "v", { name: "Riv", city: "Lon", website: "riv.com" }),
    ).rejects.toMatchObject({ code: "duplicate_competitor", status: 409 });

    mockInvoke.mockResolvedValueOnce(httpError(409, { error: "watch_limit" }));
    await expect(
      addCompetitor("b", "v", { name: "Riv", city: "Lon", website: "riv.com" }),
    ).rejects.toMatchObject({ code: "watch_limit", status: 409 });
  });

  it("watch_remove requires ok:true; search maps pool rows", async () => {
    mockInvoke.mockResolvedValueOnce(ok({ ok: true }));
    await expect(removeCompetitor("b", "c1")).resolves.toBeUndefined();
    expect(mockInvoke.mock.calls[0]![1].body).toEqual({
      action: "watch_remove",
      lane: "app",
      brand_id: "b",
      id: "c1",
    });

    mockInvoke.mockResolvedValueOnce(
      ok({
        results: [
          {
            id: "p1",
            name: "Rival",
            city: "London",
            website: "https://rival.com",
            photo_url: null,
          },
        ],
      }),
    );
    const results = await searchPlaces("b", "riv", "London");
    expect(mockInvoke.mock.calls[1]![1].body).toEqual({
      action: "search",
      lane: "app",
      brand_id: "b",
      q: "riv",
      city: "London",
    });
    expect(results).toEqual([
      {
        id: "p1",
        name: "Rival",
        city: "London",
        website: "https://rival.com",
        photoUrl: null,
      },
    ]);
  });
});

describe("issue #1735 canonical input + client hash (P-33)", () => {
  it("canonicalJsonStringify is key-order independent", () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: [1, 2] } })).toBe(
      canonicalJsonStringify({ a: { c: [1, 2], d: 2 }, b: 1 }),
    );
  });

  it("stableInputHash is stable per input state and changes on change", () => {
    const input = buildGraderInput({
      name: " Bar Toto ",
      city: " London ",
      website: " https://bartoto.com ",
    });
    expect(input).toEqual({
      name: "Bar Toto",
      city: "London",
      website: "https://bartoto.com",
    });
    const first = stableInputHash(input);
    expect(stableInputHash({ ...input })).toBe(first);
    expect(stableInputHash({ ...input, city: "Paris" })).not.toBe(first);
  });

  it("mintClientRef emits a UUID shape (the server validates it)", () => {
    const ref = mintClientRef();
    expect(ref).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("GrowthToolsAppError carries code/reason/scope", () => {
    const error = new GrowthToolsAppError("rate_limited", {
      scope: "brand",
      status: 429,
    });
    expect(error.code).toBe("rate_limited");
    expect(error.scope).toBe("brand");
    expect(error.status).toBe(429);
  });
});
