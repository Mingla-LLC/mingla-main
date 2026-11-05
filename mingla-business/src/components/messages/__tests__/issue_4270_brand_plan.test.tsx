// MINGLA-INVARIANT: I-4270-PLAN-SHEET-ABOVE-KEYBOARD | issue #4270 | the Add to plan form scrolls in the SmartScrollView wrapper with its own flex:1 bound, inside Sheet, with no react-native ScrollView and no keyboard listener, so the focused field and the buttons can clear the keyboard's Done bar. Runtime proof on devices belongs to the tester.
import fs from "node:fs";
import path from "node:path";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockNetwork: { value: { isConnected: boolean | null } | null } = { value: null };
const mockQuery: Record<string, unknown> = {};
const mockAdd = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockPending = { add: false, update: false };
const mockOpenURL = jest.fn(() => Promise.resolve());
const mockKeyboardDismiss = jest.fn();

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native");
  return { ...base, Linking: { openURL: mockOpenURL }, Keyboard: { dismiss: mockKeyboardDismiss } };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => mockNetwork.value }));
jest.mock("../../../i18n", () => ({
  useBusinessMediaTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));
jest.mock("../../../hooks/useBrandPlan", () => ({
  useBrandPlan: () => mockQuery,
  useBrandPlanWrites: () => ({
    add: { mutateAsync: mockAdd, isPending: mockPending.add },
    update: { mutateAsync: mockUpdate, isPending: mockPending.update },
    remove: { mutateAsync: mockRemove, isPending: false },
  }),
}));
function mockProbe(name: string) {
  return (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement(name, props, props.children as React.ReactNode);
}
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: mockProbe("SmartScroll") }));
// The last props each sheet got, so a test can say when the sheet has gone.
const mockSheets: Record<string, Record<string, unknown>> = {};
jest.mock("../../ui/Sheet", () => ({ Sheet: (props: Record<string, unknown>) => {
  mockSheets[String(props.testID)] = props;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return props.visible ? require("react").createElement("SheetProbe", props, props.children as React.ReactNode) : null;
} }));
jest.mock("../../ui/SheetMobile", () => ({ UNMOUNT_DELAY_MS: 280 }));
jest.mock("../../ui/Modal", () => ({ UNMOUNT_DELAY_MS: 200 }));
jest.mock("../../ui/Toast", () => ({ Toast: mockProbe("ToastProbe") }));
jest.mock("../../ui/Icon", () => ({ Icon: mockProbe("IconProbe") }));
jest.mock("../../ui/Button", () => ({ Button: mockProbe("ButtonProbe") }));
jest.mock("../../ui/Input", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return { Input: R.forwardRef((props: Record<string, unknown>, ref: unknown) => R.createElement("InputProbe", { ...props, ref: undefined, inputRef: ref })) };
});
jest.mock("../../ui/DateField", () => ({ DateField: mockProbe("DateProbe") }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { root: TestNode; unmount: () => void };
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require("../../../services/brandPlanService") as typeof import("../../../services/brandPlanService");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandPlanAddSheet } = require("../BrandPlanAddSheet") as typeof import("../BrandPlanAddSheet");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandPlanPanel } = require("../BrandPlanPanel") as typeof import("../BrandPlanPanel");

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestNode | string)[];
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

const TODAY = "2026-11-05";
const here = path.resolve(__dirname, "..");
const read = (rel: string): string => fs.readFileSync(path.resolve(here, rel), "utf8");
const byId = (root: TestNode, id: string): TestNode | undefined => root.findAll((node) => node.props.testID === id && typeof node.type === "string")[0];
const textOf = (root: TestNode): string => root.findAll((node) => node.type === "Text").map((node) => node.children.filter((c) => typeof c === "string").join("")).join(" | ");

function item(overrides: Partial<import("../../../services/brandPlanService").BrandPlanItem> = {}): import("../../../services/brandPlanService").BrandPlanItem {
  return { kind: "post", id: "i1", title: "Our new menu", on: "2026-11-06", at: null, state: "planned", state_words: "Planned", link: null, by: "host", mine: true, can_edit: true, revision: 1, ...overrides };
}

async function mountForm(extra: Record<string, unknown> = {}): Promise<{ root: TestNode; done: jest.Mock }> {
  const done = jest.fn();
  let renderer!: { root: TestNode };
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<BrandPlanAddSheet visible brandId="b1" today={TODAY} titleMax={160} onClose={jest.fn()} onDone={done} {...extra} />);
  });
  return { root: renderer.root, done };
}
async function press(node: TestNode | undefined): Promise<void> {
  if (!node) throw new Error("no node to press");
  await TestRenderer.act(async () => { await (node.props.onPress as () => unknown)(); });
}
async function type(root: TestNode, id: string, value: string): Promise<void> {
  await TestRenderer.act(async () => { (byId(root, id)?.props.onChangeText as (v: string) => void)(value); });
}
async function mountPanel(plan: unknown, query: Record<string, unknown> = {}): Promise<TestNode> {
  Object.assign(mockQuery, { data: plan, isLoading: false, isError: false, error: null, refetch: jest.fn() }, query);
  let renderer!: { root: TestNode };
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<BrandPlanPanel brandId="b1" onBack={jest.fn()} />); });
  return renderer.root;
}
const plan = (items: unknown[], canAdd = true) => ({ brand: { id: "b1", name: "Palm" }, today: TODAY, from: TODAY, to: TODAY, can_add: canAdd, items });

beforeEach(() => {
  mockNetwork.value = null;
  mockPending.add = false;
  mockAdd.mockReset();
  mockUpdate.mockReset();
  mockRemove.mockReset();
  mockKeyboardDismiss.mockClear();
  mockOpenURL.mockClear();
  for (const key of Object.keys(mockQuery)) delete mockQuery[key];
});

describe("errors are mapped by code, never by HTTP status", () => {
  it("not_found arrives as a 500 and is still not_found", () => {
    expect(service.mapBrandPlanError({ code: "P0002", status: 500, message: "not_found: This plan is not here." }).code).toBe("not_found");
    expect(service.mapBrandPlanError({ code: "P0002", status: 500, message: "anything" }).code).toBe("not_found");
  });
  it("each token has its code, and transport trouble is never offline", () => {
    const cases: [unknown, string][] = [
      [{ code: "22023", message: "locked: Mingla is already working on this post." }, "locked"],
      [{ code: "42501", message: "read_only: You can see this plan." }, "read_only"],
      [{ code: "22023", message: "too_many: You've added a lot today." }, "too_many"],
      [{ code: "22023", message: "no_host_card: Mingla hasn't set up your brand yet." }, "no_host_card"],
      [{ code: "PT409", message: "stale_write: This changed." }, "stale_write"],
      [{ code: "23505", message: "duplicate_title: Something with this name." }, "invalid"],
      [{ code: "22023", message: "invalid_link: Links start with https://" }, "invalid"],
      [{ code: "PT409", message: "try_again: The first request did not finish." }, "failed"],
      [{ code: "", message: "TypeError: Network request failed" }, "network"],
      [{ code: "42501", message: "permission denied for function" }, "failed"],
      [new Error("boom"), "failed"],
    ];
    for (const [raw, code] of cases) expect(service.mapBrandPlanError(raw).code).toBe(code);
  });
  it("too_many picks the words for adds and for changes", () => {
    expect(service.brandPlanErrorKey(service.mapBrandPlanError({ code: "22023", message: "too_many: You've added a lot today. Try again tomorrow." }), "add_failed")).toBe("err_too_many");
    expect(service.brandPlanErrorKey(service.mapBrandPlanError({ code: "22023", message: "too_many: You've made a lot of changes just now. Try again in an hour." }), "save_failed")).toBe("err_changes");
  });
});

describe("the link check agrees with the server", () => {
  it("refuses what the server refuses", () => {
    for (const bad of ["http://x.com/a", "HTTPS://X.COM", "javascript:alert(1)", "https://", "https://a b.com", "https://canva.com:x@evil.example", "https://canva.com@evil.example/", "https://canva.com" + String.fromCharCode(92) + "@evil.example",
      "https://canva.com" + String.fromCharCode(0x202e) + "moc", "https://canva.com" + String.fromCharCode(0x200b), "https://canva.com/" + String.fromCharCode(7), "https://canva.com" + String.fromCharCode(0xa0) + "/x", "https://canva.com/" + String.fromCodePoint(0xe0001), `https://${"a".repeat(1993)}`]) {
      expect(service.isBrandPlanLink(bad)).toBe(false);
    }
    expect(service.isBrandPlanLink("https://canva.com/@tobi/x")).toBe(true);
  });

  it("a link with no site is refused, a Latin or non-Latin site is not, and format characters stay refused", () => {
    for (const bad of ["https:///evil.example", "https://:443/evil", "https://?x=1", "https://#x", "https://./x",
      "https://canva.com\uFF0Fevil.example/", "https://canva.com\uFF1A443/", "https://canva.com\u{1D173}.evil.example", `https://${"a".repeat(254)}/`]) {
      expect({ bad, ok: service.isBrandPlanLink(bad) }).toEqual({ bad, ok: false });
    }
    for (const good of ["https://canva.com/x", "https://bücher.example/x", "https://саnvа.com/x", "https://canva.com:8443/x"]) {
      expect({ good, ok: service.isBrandPlanLink(good) }).toEqual({ good, ok: true });
    }
  });

  it("W4 retest: www with nothing after it, % in a site, IP addresses and dead lookalike stops are refused", () => {
    for (const bad of ["https://www./x", "https://WWW./x", "https://www../x",
      "https://canva.com%2eevil.example/", "https://canva%2ecom/", "https://%d1%81anva.example/", "https://canva\uFF05com/",
      "https://134744072/", "https://8.8.8.8/", "https://8.8.8.8./", "https://0x8.0x8.0x8.0x8/", "https://0x/", "https://\uFF11\uFF12\uFF13/", "https://[2606:4700:4700::1111]/", "https://canva\uFF3Bcom/",
      "https://canva\u2024com/", "https://canva\u2025com/", "https://canva\u2026com/", "https://a\u24881com/", "https://a\u33C2com/", "https://canva\uFE52com/", "https://canva\u{1F100}com/",
      "https://a<b.example/", "https://a>b.example/", "https://a^b.example/", "https://a|b.example/", "https://a\uFF1Cb.example/", "https://a\uFF5Cb.example/"]) {
      expect({ bad, ok: service.isBrandPlanLink(bad) }).toEqual({ bad, ok: false });
    }
    for (const good of ["https://www.canva.com/x", "https://www/x", "https://canva.com./x", "https://canva\u3002com/x", "https://canva\uFF0Ecom/x", "https://canva\uFF61com/x",
      "https://canva.com/50%25-off", "https://canva.com/8.8.8.8", "https://1password.com/", "https://a1.b2/", "https://0xcafe.example/"]) {
      expect({ good, ok: service.isBrandPlanLink(good) }).toEqual({ good, ok: true });
    }
  });
  it("W4 retest: no character folds to plain punctuation a browser refuses in a site", () => {
    const dead: string[] = [];
    for (let point = 0x80; point <= 0x1FFFF; point += 1) {
      if (point >= 0xD800 && point <= 0xDFFF) continue;
      const char = String.fromCodePoint(point);
      const folded = char.normalize("NFKC").toLowerCase();
      // Letters and digits from a newer Unicode than this runtime's are not this rule's business.
      if (folded === char || !/^[\x21-\x7e]+$/.test(folded) || /^[a-z0-9]+$/.test(folded)) continue;
      const link = `https://canva${char}com/`;
      if (!service.isBrandPlanLink(link)) continue;
      try { new URL(link); } catch { dead.push(point.toString(16)); }
    }
    expect(dead).toEqual([]);
  });
});

describe("weeks and months", () => {
  it("groups by Monday, always has this week, and places Today", () => {
    const weeks = service.brandPlanWeeks([item({ id: "a", on: "2026-11-03" }), item({ id: "b", on: "2026-11-06" }), item({ id: "c", on: "2026-11-10" }), item({ id: "d", on: "2026-11-20" })], TODAY);
    expect(weeks.map((w) => [w.key, w.label, w.todayIndex])).toEqual([["2026-11-02", "this", 1], ["2026-11-09", "next", -1], ["2026-11-16", "later", -1]]);
    expect(service.brandPlanWeeks([], TODAY).map((w) => w.label)).toEqual(["this"]);
  });
  it("a month grid is whole weeks, Monday first, and stays inside the 120-day window", () => {
    const grid = service.brandPlanMonthGrid("2026-11");
    expect(grid[0]).toBe("2026-10-26");
    expect(grid.length % 7).toBe(0);
    expect(grid[grid.length - 1]).toBe("2026-12-06");
    expect(grid.length).toBeLessThanOrEqual(42);
  });
});

describe("the Add to plan form", () => {
  it("checks in the spec's words and moves focus to the field", async () => {
    const { root } = await mountForm();
    const focus = jest.fn();
    const what = byId(root, "brand-plan-what");
    (what?.props.inputRef as { current: unknown }).current = { focus };
    await press(byId(root, "brand-plan-submit"));
    expect(byId(root, "brand-plan-what")?.props.error).toBe("plan.err_title");
    expect(focus).toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    await type(root, "brand-plan-what", "Menu");
    await type(root, "brand-plan-link", "http://x.com");
    await press(byId(root, "brand-plan-submit"));
    expect(byId(root, "brand-plan-link")?.props.error).toBe("plan.err_link");
    expect(mockAdd).not.toHaveBeenCalled();
    expect(service.brandPlanFormProblems({ type: "post", title: "x", on: "", link: "", note: "" }, TODAY)).toEqual([{ field: "on", key: "err_date" }]);
    expect(service.brandPlanFormProblems({ type: "post", title: "x", on: "2026-11-04", link: "", note: "" }, TODAY)).toEqual([{ field: "on", key: "err_date_past" }]);
    expect(service.brandPlanFormProblems({ type: "task", title: "ab", on: TODAY, link: "", note: "" }, TODAY)).toEqual([{ field: "title", key: "err_title_length" }]);
  });
  it("sends only the keys the server accepts", async () => {
    mockAdd.mockResolvedValue({ status: "added" });
    const { root, done } = await mountForm();
    await type(root, "brand-plan-what", "  Menu  ");
    await press(byId(root, "brand-plan-submit"));
    expect(mockAdd.mock.calls[0][0].item).toEqual({ type: "post", title: "Menu", on: TODAY });
    expect(mockAdd.mock.calls[0][0].requestKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(done).toHaveBeenCalledWith("added_post");
  });
  it("Adding… disables the button, so no double tap", async () => {
    mockPending.add = true;
    const { root } = await mountForm();
    const submit = byId(root, "brand-plan-submit");
    expect(submit?.props.label).toBe("plan.adding");
    expect(submit?.props.disabled).toBe(true);
  });
  it("a failed add keeps what was typed, says so, and retries with the same key", async () => {
    mockAdd.mockRejectedValue(new service.BrandPlanError("failed", "", "boom"));
    const { root, done } = await mountForm();
    await type(root, "brand-plan-what", "Menu");
    await press(byId(root, "brand-plan-submit"));
    expect(textOf(byId(root, "brand-plan-failed") as TestNode) + String((byId(root, "brand-plan-failed") as TestNode).children)).toContain("plan.add_failed");
    expect(byId(root, "brand-plan-what")?.props.value).toBe("Menu");
    expect(done).not.toHaveBeenCalled();
    await press(byId(root, "brand-plan-submit"));
    expect(mockAdd.mock.calls[1][0].requestKey).toBe(mockAdd.mock.calls[0][0].requestKey);
  });
  it("a network failure of unknown state is a failure, never offline", async () => {
    mockNetwork.value = null;
    mockAdd.mockRejectedValue(new service.BrandPlanError("network", "", "Network request failed"));
    const { root } = await mountForm();
    await type(root, "brand-plan-what", "Menu");
    await press(byId(root, "brand-plan-submit"));
    expect(byId(root, "brand-plan-offline")).toBeUndefined();
    expect(byId(root, "brand-plan-failed")).toBeDefined();
  });
  it("offline shows only when NetInfo says false, and then the button is off", async () => {
    for (const value of [null, { isConnected: null }, { isConnected: true }]) {
      mockNetwork.value = value;
      const { root } = await mountForm();
      expect(byId(root, "brand-plan-offline")).toBeUndefined();
      expect(byId(root, "brand-plan-submit")?.props.disabled).toBe(false);
    }
    mockNetwork.value = { isConnected: false };
    const { root } = await mountForm();
    expect(byId(root, "brand-plan-offline")).toBeDefined();
    expect(byId(root, "brand-plan-submit")?.props.disabled).toBe(true);
  });
  it("the form caps a title at what the plan says fits, and the counter counts to it", async () => {
    const { root } = await mountForm({ titleMax: 100 });
    expect(byId(root, "brand-plan-what")?.props.maxLength).toBe(100);
    expect(byId(root, "brand-plan-counter")).toBeUndefined();
    await type(root, "brand-plan-what", "x".repeat(80));
    expect(byId(root, "brand-plan-counter")?.children).toEqual(["80/100"]);
  });
  it("a title over the limit is never sent or cut: the host is told and it stays as typed", async () => {
    const { root } = await mountForm({ titleMax: 100 });
    await type(root, "brand-plan-what", "x".repeat(101));
    await press(byId(root, "brand-plan-submit"));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(byId(root, "brand-plan-what")?.props.error).toBe("plan.err_title_long");
    expect(byId(root, "brand-plan-what")?.props.value).toHaveLength(101);
  });
  it("a limit that went stale mid-edit: the server's refusal is shown, the title stays, and the form takes the new limit", async () => {
    mockAdd.mockRejectedValue(service.mapBrandPlanError({ code: "22023", message: "title_too_long: Keep this to 90 characters." }));
    const { root, done } = await mountForm({ titleMax: 100 });
    await type(root, "brand-plan-what", "x".repeat(95));
    await press(byId(root, "brand-plan-submit"));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    expect(String((byId(root, "brand-plan-failed") as TestNode).children)).toContain("plan.err_title_long");
    expect(byId(root, "brand-plan-what")?.props.value).toHaveLength(95);
    expect(byId(root, "brand-plan-what")?.props.maxLength).toBe(90);
  });
  it("D32: with nothing typed, tap outside, drag, Android back and web Escape close the sheet", async () => {
    const onClose = jest.fn();
    const { root } = await mountForm({ onClose });
    const sheetNode = root.findAll((n) => n.type === "SheetProbe")[0];
    expect((sheetNode.props.dismissGuard as () => boolean)()).toBe(false);
    expect(sheetNode.props.dismissDisabled).toBeFalsy();
  });
  it("D32: with something typed the sheet holds and only the keyboard goes; Cancel still closes", async () => {
    const onClose = jest.fn();
    const { root } = await mountForm({ onClose });
    await type(root, "brand-plan-what", "Still here");
    const sheetNode = root.findAll((n) => n.type === "SheetProbe")[0];
    expect((sheetNode.props.dismissGuard as () => boolean)()).toBe(true);
    (sheetNode.props.onRequestClose as () => void)();
    expect(mockKeyboardDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(byId(root, "brand-plan-what")?.props.value).toBe("Still here");
    await press(byId(root, "brand-plan-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("D32: typing and clearing it again lets go of the sheet", async () => {
    const { root } = await mountForm({});
    await type(root, "brand-plan-what", "x");
    expect((root.findAll((n) => n.type === "SheetProbe")[0].props.dismissGuard as () => boolean)()).toBe(true);
    await type(root, "brand-plan-what", "");
    expect((root.findAll((n) => n.type === "SheetProbe")[0].props.dismissGuard as () => boolean)()).toBe(false);
  });
  it("D32: a Change sheet holds only once its value differs from what it opened with", async () => {
    const { root } = await mountForm({ edit: { field: "link", item: item({ link: { url: "https://canva.com/a", site: "canva.com" } }) } });
    const guard = (): boolean => (root.findAll((n) => n.type === "SheetProbe")[0].props.dismissGuard as () => boolean)();
    expect(guard()).toBe(false);
    await type(root, "brand-plan-link", "https://canva.com/b");
    expect(guard()).toBe(true);
    await type(root, "brand-plan-link", "https://canva.com/a");
    expect(guard()).toBe(false);
  });
  it("D32: a running save holds the sheet even with nothing changed, and Cancel waits for it", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockUpdate.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    mockPending.update = true;
    const onClose = jest.fn();
    const { root } = await mountForm({ onClose, edit: { field: "date", item: item() } });
    expect((root.findAll((n) => n.type === "SheetProbe")[0].props.dismissGuard as () => boolean)()).toBe(true);
    expect(byId(root, "brand-plan-cancel")?.props.disabled).toBe(true);
    answer({});
    mockPending.update = false;
  });
  it("a change the plan has moved past closes the form with the words", async () => {
    mockUpdate.mockRejectedValue(new service.BrandPlanError("stale_write", "stale_write", "This changed."));
    const onStale = jest.fn();
    const { root } = await mountForm({ edit: { field: "date", item: item() }, onStale });
    await press(byId(root, "brand-plan-submit"));
    expect(mockUpdate.mock.calls[0][0].changes).toEqual({ on: "2026-11-06" });
    expect(onStale).toHaveBeenCalledWith("stale");
  });
});

describe("one native modal at a time: nothing opens until the sheet before it has gone (W4 retest P0-1, P2-A)", () => {
  const toastOf = (root: TestNode): TestNode => root.findAll((n) => n.type === "ToastProbe")[0];
  const gone = async (testID: string): Promise<void> => {
    await TestRenderer.act(async () => { (mockSheets[testID].onDismissed as () => void)(); });
  };
  const formOpen = (): boolean => mockSheets["brand-plan-add-sheet"]?.visible === true;
  const menuOpen = (): boolean => mockSheets["brand-plan-menu-sheet"]?.visible === true;
  beforeEach(() => { jest.useFakeTimers(); for (const key of Object.keys(mockSheets)) delete mockSheets[key]; });
  afterEach(() => { jest.useRealTimers(); });

  async function openAndSubmit(root: TestNode): Promise<void> {
    await press(byId(root, "brand-plan-add"));
    await type(root, "brand-plan-what", "Menu");
    await press(root.findAll((n) => n.props.testID === "brand-plan-submit")[0]);
  }
  for (const [route, button] of [["date", "brand-plan-change-date"], ["link", "brand-plan-change-link"]] as const) {
    it(`menu, then Change ${route}: the form opens only once the menu sheet has gone`, async () => {
      const root = await mountPanel(plan([item()]));
      await press(byId(root, "brand-plan-menu-i1"));
      expect(menuOpen()).toBe(true);
      await press(root.findAll((n) => n.props.testID === button)[0]);
      expect(menuOpen()).toBe(false);
      expect(formOpen()).toBe(false);
      await TestRenderer.act(async () => { jest.advanceTimersByTime(2000); });
      expect(formOpen()).toBe(false);
      await gone("brand-plan-menu-sheet");
      expect(formOpen()).toBe(true);
      expect(byId(root, "brand-plan-submit")).toBeDefined();
    });
  }
  it("Add: the words wait for the sheet to go, however long that takes", async () => {
    mockAdd.mockResolvedValue({ kind: "post", status: "added", item: item() });
    const root = await mountPanel(plan([]));
    await openAndSubmit(root);
    expect(formOpen()).toBe(false);
    await TestRenderer.act(async () => { jest.advanceTimersByTime(2000); });
    expect(toastOf(root).props.visible).toBe(false);
    await gone("brand-plan-add-sheet");
    expect(toastOf(root).props).toMatchObject({ visible: true, kind: "success", message: "plan.added_post" });
  });
  it("Remove: removed and locked words both arrive once the menu has gone", async () => {
    mockRemove.mockResolvedValueOnce({ removed: true }).mockRejectedValueOnce(new service.BrandPlanError("locked", "locked", "x"));
    const root = await mountPanel(plan([item()]));
    for (const message of ["plan.removed", "plan.err_locked"]) {
      await press(byId(root, "brand-plan-menu-i1"));
      await press(root.findAll((n) => n.props.testID === "brand-plan-remove")[0]);
      await press(root.findAll((n) => n.props.testID === "brand-plan-remove-confirm")[0]);
      expect(menuOpen()).toBe(false);
      expect(toastOf(root).props.visible).toBe(false);
      await gone("brand-plan-menu-sheet");
      expect(toastOf(root).props).toMatchObject({ visible: true, message });
      await TestRenderer.act(async () => { (toastOf(root).props.onDismiss as () => void)(); });
    }
  });
  it("Change: stale and locked words arrive once the form has gone", async () => {
    for (const [code, kind, message] of [["stale_write", "warn", "plan.stale"], ["locked", "warn", "plan.err_locked"]] as const) {
      mockUpdate.mockRejectedValueOnce(new service.BrandPlanError(code, code, "x"));
      const root = await mountPanel(plan([item()]));
      await press(byId(root, "brand-plan-link-edit-i1"));
      await press(root.findAll((n) => n.props.testID === "brand-plan-submit")[0]);
      expect(formOpen()).toBe(false);
      expect(toastOf(root).props.visible).toBe(false);
      await gone("brand-plan-add-sheet");
      expect(toastOf(root).props).toMatchObject({ visible: true, kind, message });
    }
  });
  it("a sheet asked for while another is going waits its turn", async () => {
    mockAdd.mockResolvedValue({ kind: "post", status: "added", item: item() });
    const root = await mountPanel(plan([item()]));
    await press(byId(root, "brand-plan-link-edit-i1"));
    await press(root.findAll((n) => n.props.testID === "brand-plan-cancel")[0]);
    await press(byId(root, "brand-plan-menu-i1"));
    expect(menuOpen()).toBe(false);
    await gone("brand-plan-add-sheet");
    expect(menuOpen()).toBe(true);
  });
  it("if a sheet never says it has gone, the plan opens again after a while", async () => {
    const root = await mountPanel(plan([item()]));
    await press(byId(root, "brand-plan-menu-i1"));
    await press(root.findAll((n) => n.props.testID === "brand-plan-change-date")[0]);
    await TestRenderer.act(async () => { jest.advanceTimersByTime(2999); });
    expect(formOpen()).toBe(false);
    await TestRenderer.act(async () => { jest.advanceTimersByTime(1); });
    expect(formOpen()).toBe(true);
  });
  it("the words stay on the card while it slides away", async () => {
    mockAdd.mockResolvedValue({ kind: "post", status: "added", item: item() });
    const root = await mountPanel(plan([]));
    await openAndSubmit(root);
    await gone("brand-plan-add-sheet");
    await TestRenderer.act(async () => { (toastOf(root).props.onDismiss as () => void)(); });
    expect(toastOf(root).props).toMatchObject({ visible: false, kind: "success", message: "plan.added_post" });
  });
  it("in the wide rail the form is not a sheet, so the words show at once", async () => {
    mockAdd.mockResolvedValue({ kind: "task", status: "added", item: item() });
    Object.assign(mockQuery, { data: plan([]), isLoading: false, isError: false, error: null, refetch: jest.fn() });
    let renderer!: { root: TestNode };
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<BrandPlanPanel brandId="b1" compact />); });
    await openAndSubmit(renderer.root);
    expect(toastOf(renderer.root).props.visible).toBe(true);
  });
});

describe("the plan's English words load with the plan (bundle budget)", () => {
  it("only the pill's words are in the copy every screen loads; the rest come with the plan and are registered", () => {
    const eager = JSON.parse(read("../../i18n/locales/en/brandGroupMedia.json")) as { plan: Record<string, string> };
    const lazy = JSON.parse(read("../../i18n/locales/en/brandPlan.json")) as { plan: Record<string, string> };
    expect(Object.keys(eager.plan).sort()).toEqual(["pill", "pill_a11y"]);
    expect(Object.keys(lazy.plan).length).toBeGreaterThan(70);
    for (const file of ["BrandPlanPanel.tsx", "BrandPlanAddSheet.tsx"]) {
      expect(read(file)).toMatch(/import \{ addPlanEnglish \} from "\.\.\/\.\.\/i18n\/brandPlanEnglish";[\s\S]*\naddPlanEnglish\(\);\n/);
    }
  });
  it("registering the words makes them readable, and keeps the pill", async () => {
    const real = jest.requireActual("../../../i18n") as typeof import("../../../i18n");
    const { addPlanEnglish } = jest.requireActual("../../../i18n/brandPlanEnglish") as typeof import("../../../i18n/brandPlanEnglish");
    expect(real.useBusinessMediaTranslation).toBeDefined();
    addPlanEnglish();
    let t: (key: string) => string = (key) => key;
    function Probe(): null { t = real.useBusinessMediaTranslation().t; return null; }
    await TestRenderer.act(async () => { TestRenderer.create(<Probe />); });
    expect(t("plan.saved")).toBe("Saved. Your plan is up to date.");
    expect(t("plan.pill")).toBe("Plan");
  });
});

describe("a sheet reports when it has really gone (useSheetGone)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require("react-native") as { Platform: { OS: string } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSheetGone } = require("../../ui/useSheetGone") as typeof import("../../ui/useSheetGone");
  let latest: ReturnType<typeof useSheetGone> = { waiting: false, onModalDismiss: undefined };
  function Probe({ mounted, onDismissed }: { mounted: boolean; onDismissed?: () => void }): null {
    latest = useSheetGone(mounted, onDismissed);
    return null;
  }
  const os = RN.Platform.OS;
  afterEach(() => { RN.Platform.OS = os; });
  it("iOS: stays in the tree until the Modal's own dismissal, then says so once", async () => {
    RN.Platform.OS = "ios";
    const done = jest.fn();
    let r!: { update: (n: React.ReactElement) => void };
    await TestRenderer.act(async () => { r = TestRenderer.create(<Probe mounted onDismissed={done} />) as unknown as typeof r; });
    expect(latest.waiting).toBe(false);
    await TestRenderer.act(async () => { r.update(<Probe mounted={false} onDismissed={done} />); });
    expect(latest.waiting).toBe(true);
    expect(done).not.toHaveBeenCalled();
    await TestRenderer.act(async () => { latest.onModalDismiss?.(); });
    expect(done).toHaveBeenCalledTimes(1);
    expect(latest.waiting).toBe(false);
    await TestRenderer.act(async () => { latest.onModalDismiss?.(); });
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("Android and web: says so once it has unmounted", async () => {
    RN.Platform.OS = "android";
    const done = jest.fn();
    let r!: { update: (n: React.ReactElement) => void };
    await TestRenderer.act(async () => { r = TestRenderer.create(<Probe mounted onDismissed={done} />) as unknown as typeof r; });
    await TestRenderer.act(async () => { r.update(<Probe mounted={false} onDismissed={done} />); });
    expect(latest.waiting).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("a sheet that does not ask keeps the old path", async () => {
    RN.Platform.OS = "ios";
    let r!: { update: (n: React.ReactElement) => void };
    await TestRenderer.act(async () => { r = TestRenderer.create(<Probe mounted />) as unknown as typeof r; });
    await TestRenderer.act(async () => { r.update(<Probe mounted={false} />); });
    expect(latest).toEqual({ waiting: false, onModalDismiss: undefined });
  });
});

describe("a write that never answers (W4 retest P2-C)", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const supa = require("../../../services/supabase") as { supabase: { rpc: jest.Mock } };
  it("fails at 25 s with the failed words; a late answer only reads the plan again", async () => {
    let answer: (v: unknown) => void = () => undefined;
    supa.supabase.rpc.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const late = jest.fn();
    const result = service.addBrandPlanItem("b1", { type: "post", title: "x", on: TODAY }, "plan_key_12345", late);
    const caught = result.catch((cause: unknown) => cause);
    await TestRenderer.act(async () => { jest.advanceTimersByTime(service.BRAND_PLAN_WRITE_TIMEOUT_MS - 1); });
    expect(late).not.toHaveBeenCalled();
    await TestRenderer.act(async () => { jest.advanceTimersByTime(1); });
    const error = (await caught) as InstanceType<typeof service.BrandPlanError>;
    expect({ code: error.code, token: error.token }).toEqual({ code: "network", token: "timed_out" });
    expect(service.brandPlanErrorKey(error, "add_failed")).toBe("add_failed");
    expect(service.brandPlanErrorKey(error, "save_failed")).toBe("save_failed");
    await TestRenderer.act(async () => { answer({ data: { status: "added" }, error: null }); });
    expect(late).toHaveBeenCalledTimes(1);
  });
  it("an answer in time clears the clock and never reads as late", async () => {
    supa.supabase.rpc.mockResolvedValue({ data: { kind: "post", id: "i1", removed: true }, error: null });
    const late = jest.fn();
    await expect(service.removeBrandPlanItem("post", "i1", 1, late)).resolves.toMatchObject({ removed: true });
    await TestRenderer.act(async () => { jest.advanceTimersByTime(60_000); });
    expect(late).not.toHaveBeenCalled();
  });
  it("the form: failed words, Cancel back, values kept, and a retry sends the same key", async () => {
    mockAdd.mockRejectedValueOnce(new service.BrandPlanError("network", "timed_out", "x")).mockResolvedValueOnce({ kind: "post", status: "added", item: item() });
    const { root, done } = await mountForm();
    await type(root, "brand-plan-what", "Hung add");
    await press(byId(root, "brand-plan-submit"));
    expect(String((byId(root, "brand-plan-failed") as TestNode).children)).toContain("plan.add_failed");
    expect(byId(root, "brand-plan-cancel")?.props.disabled).toBe(false);
    expect(byId(root, "brand-plan-what")?.props.value).toBe("Hung add");
    await press(byId(root, "brand-plan-submit"));
    expect(mockAdd.mock.calls[1][0].requestKey).toBe(mockAdd.mock.calls[0][0].requestKey);
    expect(done).toHaveBeenCalledWith("added_post");
  });
});

describe("the plan panel", () => {
  it("loading, empty, error with retry, and not available with no retry", async () => {
    let root = await mountPanel(undefined, { isLoading: true });
    expect(byId(root, "brand-plan-loading")).toBeDefined();
    root = await mountPanel(plan([]));
    expect(byId(root, "brand-plan-empty")).toBeDefined();
    root = await mountPanel(undefined, { isLoading: false, isError: true, error: new service.BrandPlanError("failed", "", "x") });
    expect(byId(root, "brand-plan-error")).toBeDefined();
    expect(root.findAll((n) => n.props.testID === "brand-plan-retry").length).toBeGreaterThan(0);
    root = await mountPanel(undefined, { isLoading: false, isError: true, error: new service.BrandPlanError("not_found", "not_found", "x") });
    expect(byId(root, "brand-plan-not-available")).toBeDefined();
    expect(root.findAll((n) => n.props.testID === "brand-plan-retry")).toHaveLength(0);
  });
  it("only someone who can add sees Add; the menu shows only with can_edit (D7)", async () => {
    let root = await mountPanel(plan([item({ id: "own" }), item({ id: "theirs", mine: false, can_edit: false, by: "mingla" })]));
    expect(byId(root, "brand-plan-add")).toBeDefined();
    expect(byId(root, "brand-plan-menu-own")).toBeDefined();
    expect(byId(root, "brand-plan-menu-theirs")).toBeUndefined();
    root = await mountPanel(plan([item({ can_edit: false })], false));
    expect(byId(root, "brand-plan-add")).toBeUndefined();
    expect(byId(root, "brand-plan-menu-i1")).toBeUndefined();
  });
  it("Add hides while the sheet is open", async () => {
    const root = await mountPanel(plan([]));
    await press(byId(root, "brand-plan-add"));
    expect(byId(root, "brand-plan-add")).toBeUndefined();
    expect(root.findAll((n) => n.type === "SheetProbe").length).toBeGreaterThan(0);
  });
  it("hosts see Mingla, never a staff name; a link opens only when it passes the check", async () => {
    const root = await mountPanel(plan([
      item({ id: "m", mine: false, can_edit: false, by: "mingla", link: { url: "https://canva.com/x", site: "canva.com" } }),
      item({ id: "bad", link: { url: "http://evil.example", site: "evil.example" } }),
    ]));
    expect(textOf(root)).toContain("plan.by_mingla");
    await press(byId(root, "brand-plan-open-m"));
    expect(mockOpenURL).toHaveBeenCalledWith("https://canva.com/x");
    mockOpenURL.mockClear();
    await press(byId(root, "brand-plan-open-bad"));
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
  it("Remove asks first, without Alert (which does nothing on web)", async () => {
    mockRemove.mockResolvedValue({ removed: true });
    const root = await mountPanel(plan([item()]));
    await press(byId(root, "brand-plan-menu-i1"));
    expect(root.findAll((n) => n.props.testID === "brand-plan-remove-confirm")).toHaveLength(0);
    await press(root.findAll((n) => n.props.testID === "brand-plan-remove")[0]);
    await press(root.findAll((n) => n.props.testID === "brand-plan-remove-confirm")[0]);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(read("BrandPlanPanel.tsx")).not.toContain("Alert.alert");
    // Let the words that follow the closing sheet land inside this test.
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  });
  it("a day in the month grid lists its items or says it is empty", async () => {
    const root = await mountPanel(plan([item()]));
    await press(byId(root, "brand-plan-seg-calendar"));
    await press(byId(root, "brand-plan-day-2026-11-07"));
    expect(byId(root, "brand-plan-day-empty")).toBeDefined();
    await press(byId(root, "brand-plan-day-2026-11-06"));
    expect(byId(root, "brand-plan-item-i1")).toBeDefined();
  });
});

describe("source contracts", () => {
  const chat = read("../../../app/messages/[conversationId].tsx");
  const sheet = read("BrandPlanAddSheet.tsx");
  const panel = read("BrandPlanPanel.tsx");
  it("I-4270-PLAN-SHEET-ABOVE-KEYBOARD: Sheet + SmartScrollView, bounded, no listeners", () => {
    expect(sheet).toContain('import { ScrollView } from "../../wrappers/SmartScrollView"');
    expect(sheet).toContain("style={styles.scrollFlex}");
    expect(sheet).toMatch(/scrollFlex:\s*\{ flex: 1 \}/);
    expect(sheet).toContain("<Sheet ");
    for (const source of [sheet, panel]) {
      expect(source).not.toMatch(/import \{[^}]*\bScrollView\b[^}]*\} from "react-native"/);
      expect(source).not.toContain("Keyboard.addListener");
    }
    // The form only ever asks the keyboard to go away (tapping outside, D31).
    expect(sheet.match(/Keyboard\.\w+/g)).toEqual(["Keyboard.dismiss"]);
    expect(panel).not.toMatch(/\bKeyboard\b/);
  });
  it("the pill is only for the brand's own team on a phone, and the rail order is People, Plan, Media", () => {
    expect(chat).toContain('const planBrandId = canBrand && group ? group.brand_id : null;');
    expect(chat).toContain("{!isWideDesktop && planBrandId ? (");
    expect(chat).toContain('testID="brand-plan-pill"');
    const rail = chat.slice(chat.indexOf('testID="brand-group-rail-tabs"'));
    const people = rail.indexOf("People ·");
    const planTab = rail.indexOf('t("plan.pill")');
    const media = rail.indexOf('t("chat.media")');
    expect(people).toBeGreaterThan(-1);
    expect(people).toBeLessThan(planTab);
    expect(planTab).toBeLessThan(media);
    expect(chat).toContain('requestedGallery === "1" ? "media" : "plan"');
    expect(chat).toContain('desktopDetailTab === "plan" && !planBrandId ? "people"');
  });
  it("a system line is a centred line with no Reply or Select, and it refreshes the plan", () => {
    const start = chat.indexOf('if (message.message_type === "system")');
    expect(start).toBeGreaterThan(-1);
    const block = chat.slice(start, chat.indexOf('if (message.message_type === "brand_enquiry_card")'));
    expect(block).toContain("styles.systemLine");
    expect(block).not.toContain("Reply");
    expect(block).not.toContain("Select");
    expect(chat).toContain('payload.new?.message_type === "system"');
  });
});

// #3493 bundle gate (W6): nothing of the plan loads with the chat or with every
// screen. The chat refreshes the plan through the lazy plan module, and the
// Post/Task choice is the sheet's own copy of OptionCard, so OptionCard stays
// with its one other lazy screen.
describe("the plan stays out of the first download (W6)", () => {
  const chat = read("../../../app/messages/[conversationId].tsx");
  const sheet = read("BrandPlanAddSheet.tsx");
  const panel = read("BrandPlanPanel.tsx");
  const staticImports = (source: string): string[] => [...source.matchAll(/^import[^;]*?from "([^"]+)";/gms)].map((m) => m[1]);

  it("the chat imports nothing of the plan up front; only the lazy loader does", () => {
    const eager = staticImports(chat);
    expect(eager.filter((from) => /brandPlan|BrandPlan|useBrandPlan/.test(from))).toEqual([]);
    expect(chat).not.toContain("brandPlanKeys");
    // One loader fetches the plan module; the other mention is a type only.
    expect(chat.match(/await import\("\.\.\/\.\.\/src\/components\/messages\/BrandPlanPanel"\)/g)?.length).toBe(1);
    expect(chat).toContain('let loadedPlanModule: typeof import("../../src/components/messages/BrandPlanPanel") | null = null;');
  });
  it("a quiet plan line refreshes the plan through the loaded plan module", () => {
    expect(chat).toMatch(/loadedPlanModule = module;\s*return \{ default: module\.BrandPlanPanel \};/);
    const handler = chat.slice(chat.indexOf("// #4270: a quiet plan line means the plan changed."));
    expect(handler.slice(0, 300)).toMatch(/if \(planBrandId && payload\.new\?\.message_type === "system" && loadedPlanModule\) \{\s*void loadedPlanModule\.refreshBrandPlan\(queryClient, planBrandId\);/);
    expect(panel).toContain('export { refreshBrandPlan } from "../../hooks/useBrandPlan";');
  });
  it("refreshBrandPlan marks every window of that brand stale, and no other brand's", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { QueryClient } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
    const real = jest.requireActual("../../../hooks/useBrandPlan") as typeof import("../../../hooks/useBrandPlan");
    const client = new QueryClient();
    const nov = real.brandPlanKeys.window("b1", "2026-11-01", "2026-11-30", "u1");
    const dec = real.brandPlanKeys.window("b1", "2026-12-01", "2026-12-31", "u1");
    const other = real.brandPlanKeys.window("b2", "2026-11-01", "2026-11-30", "u1");
    for (const key of [nov, dec, other]) client.setQueryData(key, { items: [] });
    await real.refreshBrandPlan(client, "b1");
    expect(client.getQueryState(nov)?.isInvalidated).toBe(true);
    expect(client.getQueryState(dec)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
  it("the sheet does not import OptionCard", () => {
    expect(staticImports(sheet).some((from) => /OptionCard/.test(from))).toBe(false);
  });
  it("Post and Task look and read exactly like OptionCard, unselected and selected", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StyleSheet } = require("react-native") as typeof import("react-native");
    const { OptionCard } = jest.requireActual("../../ui/OptionCard") as typeof import("../../ui/OptionCard");
    type Shape = { type: string; style: unknown; a11y: unknown[]; text: string[]; kids: Shape[] };
    const shape = (node: TestNode): Shape => ({
      type: String(node.type),
      style: StyleSheet.flatten(node.props.style as never) ?? null,
      a11y: [node.props.accessibilityRole, node.props.accessibilityState, node.props.accessibilityLabel, node.props.accessibilityHint, node.props.disabled, node.props.testID, node.props.name, node.props.size, node.props.color],
      text: node.children.filter((c): c is string => typeof c === "string"),
      kids: hosts(node).map(shape),
    });
    // The nearest host nodes under a node, looking through components.
    const hosts = (node: TestNode): TestNode[] => node.children
      .filter((c): c is TestNode => typeof c !== "string")
      .flatMap((c) => (typeof c.type === "string" ? [c] : hosts(c)));
    const { root } = await mountForm();
    for (const [id, selected] of [["brand-plan-type-post", true], ["brand-plan-type-task", false]] as const) {
      const ours = byId(root, id);
      expect(ours).toBeDefined();
      const label = id.endsWith("post") ? "plan.kind_post" : "plan.kind_task";
      const helper = id.endsWith("post") ? "plan.help_post" : "plan.help_task";
      let reference!: { root: TestNode };
      await TestRenderer.act(async () => {
        reference = TestRenderer.create(<OptionCard label={label} helper={helper} selected={selected} onPress={jest.fn()} disabled={false} testID={id} />);
      });
      const theirs = byId(reference.root, id);
      expect(theirs).toBeDefined();
      expect(shape(ours as TestNode)).toEqual(shape(theirs as TestNode));
      expect((ours as TestNode).props.accessibilityState).toEqual({ checked: selected, disabled: false });
    }
    // Disabled while a save runs: same dimmed card.
    mockPending.add = true;
    const busy = await mountForm();
    const dimmed = byId(busy.root, "brand-plan-type-task") as TestNode;
    let ref!: { root: TestNode };
    await TestRenderer.act(async () => {
      ref = TestRenderer.create(<OptionCard label="plan.kind_task" helper="plan.help_task" selected={false} onPress={jest.fn()} disabled testID="brand-plan-type-task" />);
    });
    expect(shape(dimmed)).toEqual(shape(byId(ref.root, "brand-plan-type-task") as TestNode));
  });
  it("pressing Task chooses Task", async () => {
    const { root } = await mountForm();
    // Pressable's host node has no onPress; drive it through the composite.
    const composite = root.findAll((node) => node.props.testID === "brand-plan-type-task" && typeof node.props.onPress === "function")[0];
    await press(composite);
    expect((byId(root, "brand-plan-type-task") as TestNode).props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect((byId(root, "brand-plan-type-post") as TestNode).props.accessibilityState).toEqual({ checked: false, disabled: false });
  });
});
