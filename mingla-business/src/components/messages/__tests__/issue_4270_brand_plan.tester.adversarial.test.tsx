// Issue #4270 (Wave 4): tester adversarial suite. The implementor's suite mocks
// the hook; this one runs the real hook and writes against a real QueryClient
// and raw PostgREST answers, and holds the client to the migration's own text:
// every token the server raises, every state it sends, its hidden-character
// list and its request-key rule. Calendar edges and all 29 languages too.
import fs from "node:fs";
import path from "node:path";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRpc = jest.fn();
const mockUser: { id: string | null; ready: boolean } = { id: "user-a", ready: true };
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: mockUser.ready, user: mockUser.id ? { id: mockUser.id } : null }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { unmount: () => void };
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hooks = require("../../../hooks/useBrandPlan") as typeof import("../../../hooks/useBrandPlan");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require("../../../services/brandPlanService") as typeof import("../../../services/brandPlanService");

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/20280414024270_issue_4270_w3_brand_plan.sql"), "utf8");
// W5: the link rule moved to the host card migration, where the Files link uses it too.
const LINK_RULE_MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/20280414014270_issue_4270_w2_host_card.sql"), "utf8");
const LOCALES = path.join(ROOT, "mingla-business/src/i18n/locales");
const en = JSON.parse(fs.readFileSync(path.join(LOCALES, "en/brandGroupMedia.json"), "utf8")).plan as Record<string, string>;
const PANEL = fs.readFileSync(path.join(ROOT, "mingla-business/src/components/messages/BrandPlanPanel.tsx"), "utf8");

const PLAN = { brand: { id: "b", name: "Palm" }, today: "2026-11-05", from: "2026-10-29", to: "2027-02-03", can_add: true, items: [] };
const NOT_FOUND = { code: "P0002", details: null, hint: null, message: "not_found: This plan is not here." };

function client(): InstanceType<typeof QueryClient> {
  // Retry delays off: what is under test is the hook's own retry rule.
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
}

async function mount<T>(qc: InstanceType<typeof QueryClient>, useIt: () => T): Promise<{ current: () => T; unmount: () => void }> {
  let last: T;
  function Probe(): null {
    last = useIt();
    return null;
  }
  let tree: { unmount: () => void } | undefined;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Probe)));
  });
  return { current: () => last, unmount: () => tree?.unmount() };
}

async function settle(ms = 30): Promise<void> {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  mockRpc.mockReset();
  mockUser.id = "user-a";
  mockUser.ready = true;
});

describe("the real hook against raw PostgREST answers", () => {
  it("a plan the caller cannot read is asked for once, with no retry loop", async () => {
    mockRpc.mockResolvedValue({ data: null, error: NOT_FOUND });
    const hook = await mount(client(), () => hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"));
    await settle(80);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect((hook.current().error as InstanceType<typeof service.BrandPlanError>).code).toBe("not_found");
    hook.unmount();
  });

  it("any other failure is tried three times in all, then an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "", message: "TypeError: Failed to fetch" } });
    const hook = await mount(client(), () => hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"));
    await settle(120);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect((hook.current().error as InstanceType<typeof service.BrandPlanError>).code).toBe("network");
    hook.unmount();
  });

  it("asks nothing until auth is ready, and nothing with no user", async () => {
    mockUser.ready = false;
    let hook = await mount(client(), () => hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"));
    await settle();
    expect(mockRpc).not.toHaveBeenCalled();
    hook.unmount();
    mockUser.ready = true;
    mockUser.id = null;
    hook = await mount(client(), () => hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"));
    await settle();
    expect(mockRpc).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("one user's plan is never served to the next user from the cache", async () => {
    const qc = client();
    mockRpc.mockResolvedValue({ data: { ...PLAN, brand: { id: "b", name: "A's view" } }, error: null });
    let hook = await mount(qc, () => hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"));
    await settle();
    expect(hook.current().data?.brand.name).toBe("A's view");
    hook.unmount();
    mockUser.id = "user-b";
    mockRpc.mockResolvedValue({ data: { ...PLAN, brand: { id: "b", name: "B's view" } }, error: null });
    hook = await mount(qc, () => hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"));
    expect(hook.current().data).toBeUndefined();
    await settle();
    expect(hook.current().data?.brand.name).toBe("B's view");
    hook.unmount();
  });

  it("an empty answer is a failure, never an empty plan", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(service.fetchBrandPlan("b", "2026-11-01", "2026-11-30")).rejects.toMatchObject({ code: "failed" });
    mockRpc.mockResolvedValue({ data: { brand: {} }, error: null });
    await expect(service.fetchBrandPlan("b", "2026-11-01", "2026-11-30")).rejects.toMatchObject({ code: "failed" });
  });

  it("a thrown transport error is mapped too, not left raw", async () => {
    mockRpc.mockRejectedValue(new TypeError("Network request failed"));
    await expect(service.fetchBrandPlan("b", "2026-11-01", "2026-11-30")).rejects.toMatchObject({ code: "network" });
  });

  it("a saved add reads the plan again, puts nothing in by hand, and a stale change reads it too", async () => {
    const qc = client();
    mockRpc.mockImplementation((name: string) => Promise.resolve(
      name === "brand_plan_for_host" ? { data: PLAN, error: null }
        : name === "brand_plan_host_add" ? { data: { kind: "post", status: "added", item: {} }, error: null }
          : { data: null, error: { code: "PT409", message: "stale_write: This changed. Showing the latest." } },
    ));
    const hook = await mount(qc, () => ({ plan: hooks.useBrandPlan("b", "2026-11-01", "2026-11-30"), writes: hooks.useBrandPlanWrites("b") }));
    await settle();
    const reads = (): number => mockRpc.mock.calls.filter(([name]) => name === "brand_plan_for_host").length;
    expect(reads()).toBe(1);
    await TestRenderer.act(async () => {
      await hook.current().writes.add.mutateAsync({ item: { type: "post", title: "x", on: "2026-11-09" }, requestKey: "plan_key_1" });
    });
    await settle();
    expect(reads()).toBe(2);
    expect(hook.current().plan.data?.items).toEqual([]);
    const item = { kind: "post", id: "p", revision: 3 } as never;
    await TestRenderer.act(async () => {
      await expect(hook.current().writes.update.mutateAsync({ item, changes: { on: "2026-11-10" } })).rejects.toMatchObject({ code: "stale_write" });
    });
    await settle();
    expect(reads()).toBe(3);
    expect(mockRpc).toHaveBeenCalledWith("brand_plan_host_update", { p_kind: "post", p_id: "p", p_changes: { on: "2026-11-10" }, p_expected_revision: 3 });
    hook.unmount();
  });
});

describe("the client against the migration's own text", () => {
  // What the four host functions and the helpers they call can raise. The staff
  // Calendar's own tokens in the same file never reach the Host app.
  const hostFunctions = [
    ["CREATE FUNCTION public.brand_plan_clean_link", "CREATE FUNCTION public.brand_plan_staff_first"],
    ["CREATE FUNCTION public.brand_plan_window_check", "CREATE FUNCTION public.brand_plan_free_title"],
    ["CREATE FUNCTION public.brand_plan_for_host", "CREATE FUNCTION public.brand_plan_link_words"],
    ["CREATE FUNCTION public.brand_plan_clean_item", "CREATE FUNCTION public.ops_brand_plan_add"],
    ["CREATE FUNCTION public.brand_plan_host_add", "CREATE FUNCTION public.brand_plan_flag_line"],
  ].map(([from, to]) => MIGRATION.slice(MIGRATION.indexOf(from), MIGRATION.indexOf(to))).join("\n");
  const tokens = [...new Set([...hostFunctions.matchAll(/RAISE EXCEPTION '([a-z_]+):/g)].map((m) => m[1]))];

  it("finds the tokens it is meant to hold the client to", () => {
    expect(tokens).toEqual(expect.arrayContaining(["not_found", "read_only", "too_many", "locked", "stale_write", "duplicate_title", "invalid_link", "no_host_card"]));
    expect(tokens).not.toContain("copy_locked");
  });

  it.each(tokens)("%s maps to a code, and to words the app really has", (token) => {
    const error = service.mapBrandPlanError({ code: "22023", message: `${token}: words` });
    // The bare "invalid" is only for a malformed call the form cannot make.
    if (token !== "invalid") expect(error.code).not.toBe("failed");
    const key = service.brandPlanErrorKey(error, "add_failed");
    expect(en[key]).toEqual(expect.any(String));
  });

  it("maps by the database code even with no token, whatever the HTTP status was", () => {
    expect(service.mapBrandPlanError({ code: "P0002", message: "anything" }).code).toBe("not_found");
    expect(service.mapBrandPlanError({ code: "", message: "JWT expired" }).code).toBe("failed");
    expect(service.mapBrandPlanError({ code: "XX000", message: "network of lies" }).code).toBe("failed");
    expect(service.mapBrandPlanError(null).code).toBe("failed");
  });

  it("a thrown raw constraint message is a failure, and shows nothing of it", () => {
    const error = service.mapBrandPlanError({ code: "23502", message: 'null value in column "due_on" of relation "ops_work_cards"' });
    expect(error.code).toBe("failed");
    expect(service.brandPlanErrorKey(error, "add_failed")).toBe("add_failed");
  });

  it("the request key always passes the server's rule", () => {
    const rule = /p_request_key !~ '(\^\[A-Za-z0-9_-\]\{8,80\}\$)'/.exec(MIGRATION);
    expect(rule).not.toBeNull();
    const pattern = new RegExp((rule as RegExpExecArray)[1]);
    for (let i = 0; i < 200; i += 1) expect(service.brandPlanRequestKey()).toMatch(pattern);
    expect(new Set(Array.from({ length: 200 }, () => service.brandPlanRequestKey())).size).toBe(200);
  });

  it("every state the server sends has words in the app", () => {
    const body = /CREATE FUNCTION public\.brand_plan_state_words[\s\S]*?\$\$;/.exec(MIGRATION)?.[0] ?? "";
    const states = [...body.matchAll(/WHEN '([a-z_]+)' THEN/g)].map((m) => m[1]).filter((state) => state !== "promised");
    expect(states.length).toBeGreaterThan(8);
    for (const state of states) {
      expect(en[`state_${state}`]).toEqual(expect.any(String));
      expect(PANEL).toContain(`"${state}"`);
    }
  });

  it("every code point the server's hidden list names is refused by the client as well", () => {
    const body = /CREATE FUNCTION public\.brand_plan_link_hidden[\s\S]*?\$\$;/.exec(LINK_RULE_MIGRATION)?.[0] ?? "";
    const cls = /\[\[:cntrl:\]([^\]]+)\]/.exec(body)?.[1] ?? "";
    const parts = [...cls.matchAll(/\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))(?:-\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})))?/g)];
    expect(parts.length).toBeGreaterThan(15);
    for (const part of parts) {
      const from = parseInt(part[1] ?? part[2], 16);
      const to = parseInt(part[3] ?? part[4] ?? part[1] ?? part[2], 16);
      const sample = [from, to, Math.floor((from + to) / 2)];
      for (const point of sample) {
        const link = `https://canva.com/a${String.fromCodePoint(point)}b`;
        expect({ point: point.toString(16), ok: service.isBrandPlanLink(link) }).toEqual({ point: point.toString(16), ok: false });
      }
    }
    for (let point = 0; point < 0x20; point += 1) expect(service.isBrandPlanLink(`https://canva.com/${String.fromCharCode(point)}`)).toBe(false);
  });

  it("what may follow the site name is still allowed; what comes before it is not", () => {
    for (const ok of ["https://canva.com/a@b", "https://canva.com/?who=@me", "https://canva.com/#@", "https://canva.com:8443/x"]) expect(service.isBrandPlanLink(ok)).toBe(true);
    for (const bad of ["https:///evil.example", "https://:443/evil", "https://?x=1", "https://#x", "https://a@b.example", "https://a:b@c.example/", "https://a%2F@c.example/", "https://a\\@c.example/", "https://a\\c.example/", "HTTPS://a.example/x", "http://a.example/x"]) {
      expect(service.isBrandPlanLink(bad)).toBe(false);
    }
    expect(service.isBrandPlanLink(`https://a.example/${"x".repeat(2000)}`)).toBe(false);
  });
});

describe("dates at their edges", () => {
  const item = (on: string) => ({ on, id: on }) as never;

  it("on a Sunday, today is still in the week that started on Monday", () => {
    const weeks = service.brandPlanWeeks([item("2026-11-08"), item("2026-11-02"), item("2026-11-09")], "2026-11-08");
    expect(weeks.map((week) => [week.key, week.label])).toEqual([["2026-11-02", "this"], ["2026-11-09", "next"]]);
  });

  it("a week across the new year is one week", () => {
    expect(service.mondayOf("2027-01-01")).toBe("2026-12-28");
    expect(service.mondayOf("2026-12-31")).toBe("2026-12-28");
  });

  it("items from before this week keep their own week, ahead of this one, and Today still shows once", () => {
    const weeks = service.brandPlanWeeks([item("2026-10-30"), item("2026-11-05")], "2026-11-05");
    expect(weeks.map((week) => week.label)).toEqual(["later", "this"]);
    expect(weeks.filter((week) => week.todayIndex >= 0)).toHaveLength(1);
  });

  it("every month for three years is whole weeks, Monday first, within the server's 120-day window", () => {
    let month = "2026-01";
    for (let i = 0; i < 36; i += 1) {
      const grid = service.brandPlanMonthGrid(month);
      expect(grid.length % 7).toBe(0);
      expect(new Date(`${grid[0]}T12:00:00Z`).getUTCDay()).toBe(1);
      expect(grid).toContain(`${month}-01`);
      expect(grid.length).toBeLessThanOrEqual(42);
      expect(new Set(grid).size).toBe(grid.length);
      month = service.addMonths(month, 1);
    }
    expect(service.addMonths("2026-01", -1)).toBe("2025-12");
    expect(service.addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("the timeline's window stays inside the server's limit", () => {
    const from = service.addIsoDays("2026-11-05", -7);
    const to = service.addIsoDays("2026-11-05", 90);
    expect((Date.parse(to) - Date.parse(from)) / 86400000).toBeLessThanOrEqual(120);
    expect(PANEL).toContain("addIsoDays(deviceToday, -7)");
    expect(PANEL).toContain("addIsoDays(deviceToday, 90)");
  });

  it("the form's date check agrees with its boundary", () => {
    const form = { type: "post" as const, title: "x", on: "2026-11-05", link: "", note: "" };
    expect(service.brandPlanFormProblems(form, "2026-11-05")).toEqual([]);
    expect(service.brandPlanFormProblems({ ...form, on: "2026-11-04" }, "2026-11-05")[0].key).toBe("err_date_past");
    expect(service.brandPlanFormProblems({ ...form, title: "  " }, "2026-11-05")[0]).toEqual({ field: "title", key: "err_title" });
    expect(service.brandPlanFormProblems({ ...form, type: "task", title: "ab" }, "2026-11-05")[0].key).toBe("err_title_length");
    expect(service.brandPlanFormProblems({ ...form, note: "n".repeat(501) }, "2026-11-05")[0].key).toBe("err_note");
  });

  it("only keys the server accepts leave the form, trimmed, with no empties", () => {
    expect(service.brandPlanNewItem({ type: "task", title: "  Hi  ", on: "2026-11-05", link: " ", note: "  " })).toEqual({ type: "task", title: "Hi", on: "2026-11-05" });
    const allowed = /brand_plan_clean_item\(p_item, ARRAY\[([^\]]+)\]/.exec(MIGRATION)?.[1] ?? "";
    for (const key of Object.keys(service.brandPlanNewItem({ type: "post", title: "a", on: "2026-11-05", link: "https://a.example", note: "n" }))) {
      expect(allowed).toContain(`'${key}'`);
    }
  });
});

describe("all 29 languages", () => {
  const languages = fs.readdirSync(LOCALES).filter((name) => fs.existsSync(path.join(LOCALES, name, "brandGroupMedia.json")));

  it("are all here", () => {
    expect(languages).toHaveLength(29);
  });

  it.each(languages)("%s has every plan string, none blank, none naming the wrong thing", (language) => {
    const copy = JSON.parse(fs.readFileSync(path.join(LOCALES, language, "brandGroupMedia.json"), "utf8")).plan as Record<string, string>;
    expect(Object.keys(copy).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(copy)) {
      expect({ key, blank: value.trim() === "" }).toEqual({ key, blank: false });
      const holes = (text: string): string[] => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect({ key, holes: holes(value) }).toEqual({ key, holes: holes(en[key]) });
      expect({ key, raw: /plan\.[a-z_]+/.test(value) }).toEqual({ key, raw: false });
    }
    expect(copy.err_link).toContain("https://");
  });

  it.each(languages)("%s can format the plan's dates", (language) => {
    expect(() => new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date("2026-11-05T12:00:00Z"))).not.toThrow();
  });
});

describe("the title limit and the site name, against what the server refuses", () => {
  const form = (title: string): import("../../../services/brandPlanService").BrandPlanFormValues => ({ type: "post", title, on: "2026-12-01", link: "", note: "" });

  it("holds the limit the plan sent, at the edge and one past it", () => {
    expect(service.brandPlanFormProblems(form("x".repeat(141)), "2026-11-05", 141)).toEqual([]);
    expect(service.brandPlanFormProblems(form("x".repeat(142)), "2026-11-05", 141)).toEqual([{ field: "title", key: "err_title_long" }]);
    expect(service.brandPlanFormProblems(form(`  ${"x".repeat(141)}  `), "2026-11-05", 141)).toEqual([]);
  });

  it("reads the new limit out of the server's refusal, and only out of that one", () => {
    const refused = service.mapBrandPlanError({ code: "22023", message: "title_too_long: Keep this to 87 characters." });
    expect(refused.code).toBe("invalid");
    expect(service.brandPlanTitleLimit(refused)).toBe(87);
    expect(service.brandPlanErrorKey(refused, "add_failed")).toBe("err_title_long");
    expect(service.brandPlanTitleLimit(service.mapBrandPlanError({ code: "22023", message: "invalid_note: Keep the note to 500 characters." }))).toBeNull();
  });

  it("every language says the limit", () => {
    for (const lang of fs.readdirSync(LOCALES)) {
      const plan = JSON.parse(fs.readFileSync(path.join(LOCALES, lang, "brandGroupMedia.json"), "utf8")).plan as Record<string, string>;
      expect(`${lang}:${plan.err_title_long.includes("{{max}}")}`).toBe(`${lang}:true`);
    }
  });

  it("a site must stay one site once folded, and be short enough to be an address", () => {
    for (const ok of ["https://саnvа.example/x", "https://bücher.example/", `https://${"a".repeat(253)}/`]) expect(service.isBrandPlanLink(ok)).toBe(true);
    for (const bad of ["https://./x", "https://canva.com／evil.example/", "https://canva.com＠evil.example/", "https://canva.com：443/", `https://${"a".repeat(254)}/`]) {
      expect(service.isBrandPlanLink(bad)).toBe(false);
    }
  });

  it("words raised as a sheet closes wait for it, and the Add sheet holds what was typed", () => {
    // W5: words wait for the sheet to have really gone (Sheet onDismissed), not a timer.
    expect(PANEL).toMatch(/say\(\{ kind: "success", message: t\("plan\.removed"\) \}\)/);
    expect(PANEL).not.toMatch(/setToast\(\{ kind: "success", message: t\("plan\.removed"\) \}\)/);
    expect(PANEL).toMatch(/onStale=\{\(key\) => \{ closeForm\(\); say\(/);
    expect(PANEL).toMatch(/onDismissed=\{\(\) => sheetGone\("menu"\)\}/);
    const sheet = fs.readFileSync(path.join(ROOT, "mingla-business/src/components/messages/BrandPlanAddSheet.tsx"), "utf8");
    expect(sheet).toMatch(/dismissGuard=\{holdTheSheet\}/);
    expect(sheet).toMatch(/maxLength=\{titleMax\}/);
  });
});
