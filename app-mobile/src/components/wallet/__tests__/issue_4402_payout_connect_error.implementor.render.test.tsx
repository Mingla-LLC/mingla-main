/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4402 — a refused bank connect shows its error directly under the button
 * that caused it ("Yes, connect this account" / "Connect bank"), never at the
 * bottom of the form where the sticky footer hides it.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

type QueryResult = { data?: unknown; isLoading: boolean; isError: boolean; error?: unknown };
const mockQueries: Record<string, QueryResult> = {};
const mockCheckAccount = jest.fn();
const mockSaveAccount = jest.fn();
const mockConnectWithLink = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    mockQueries[queryKey.join("/")] ?? { data: undefined, isLoading: false, isError: false },
  useQueryClient: () => ({
    invalidateQueries: jest.fn(() => Promise.resolve()),
    fetchQuery: jest.fn(() => Promise.resolve({ connected: false })),
  }),
}));

jest.mock("../../../services/payoutService", () => ({
  PAYOUT_COUNTRIES: [{ code: "NG", name: "Nigeria", currency: "NGN" }, { code: "GB", name: "United Kingdom", currency: "GBP" }],
  payoutCountry: (code: string | null) => (code ? { code, name: code, currency: "NGN" } : null),
  usesInAppAccountCheck: (code: string | null) => code === "NG",
  payoutService: {
    status: jest.fn(),
    banks: jest.fn(),
    checkAccount: (...args: unknown[]) => mockCheckAccount(...args),
    saveAccount: (...args: unknown[]) => mockSaveAccount(...args),
    connectWithLink: (...args: unknown[]) => mockConnectWithLink(...args),
  },
}));

jest.mock("../../../services/creatorProgramService", () => ({ creatorProgramService: { ownProfile: jest.fn() } }));

jest.mock("../../../services/programResult", () => ({
  programErrorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

jest.mock("../../programs/ProgramPickers", () => {
  const ReactActual = jest.requireActual("react");
  return { ChoiceField: (props: Record<string, unknown>) => ReactActual.createElement("ChoiceField", props) };
});

jest.mock("../../programs/ProgramUi", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  const host = (name: string) => (props: Record<string, unknown>) => h(name, props, props.children as React.ReactNode);
  return {
    programStyles: {},
    ProgramButton: host("ProgramButton"),
    ProgramField: host("ProgramField"),
    ProgramLoading: host("ProgramLoading"),
    ProgramNotice: host("ProgramNotice"),
    ProgramCard: host("ProgramCard"),
    ProgramRow: host("ProgramRow"),
  };
});

const { PayoutConnect } = require("../PayoutConnect");

type Renderer = import("react-test-renderer").ReactTestRenderer;
type Instance = import("react-test-renderer").ReactTestInstance;

async function run(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<Renderer> {
  let renderer: Renderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(<PayoutConnect />);
  });
  return renderer as unknown as Renderer;
}

function button(r: Renderer, label: string): Instance {
  return r.root.find((n) => (n.type as unknown) === "ProgramButton" && n.props.label === label);
}

function errorNotices(r: Renderer): Instance[] {
  return r.root.findAll((n) => (n.type as unknown) === "ProgramNotice" && n.props.tone === "error");
}

/**
 * The element rendered right after `node` in the same parent. Each mocked
 * Program* host element sits inside its own mock component, so compare at the
 * mock-component level and return the next one's host element.
 */
function nextSibling(node: Instance): Instance | null {
  const wrapper = typeof node.parent?.type === "function" ? node.parent : node;
  const siblings = (wrapper.parent?.children ?? []).filter((c): c is Instance => typeof c !== "string");
  const next = siblings[siblings.indexOf(wrapper) + 1];
  if (!next) return null;
  if (typeof next.type === "string") return next;
  const inner = next.children.find((c): c is Instance => typeof c !== "string");
  return inner ?? null;
}

function hostParentType(node: Instance): unknown {
  let at = node.parent;
  while (at && typeof at.type !== "string") at = at.parent;
  return at?.type;
}

async function chooseNigeriaBank(r: Renderer): Promise<void> {
  const [countryField] = r.root.findAll((n) => (n.type as unknown) === "ChoiceField");
  await run(() => countryField.props.onChange("NG"));
  const bankField = r.root.findAll((n) => (n.type as unknown) === "ChoiceField")[1];
  await run(() => bankField.props.onChange("057"));
  const accountField = r.root.find((n) => (n.type as unknown) === "ProgramField");
  await run(() => accountField.props.onChangeText("0000000000"));
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockQueries)) delete mockQueries[k];
  mockQueries["creator/payout"] = { data: { connected: false, pending: false }, isLoading: false, isError: false };
  mockQueries["payout/banks"] = { data: [{ code: "057", name: "Zenith Bank" }], isLoading: false, isError: false };
});

describe("#4402 PayoutConnect error placement", () => {
  it("a refused save shows its error directly under 'Yes, connect this account'", async () => {
    mockCheckAccount.mockResolvedValue({ account_name: "ADA OBI", account_number_masked: "******0000" });
    mockSaveAccount.mockRejectedValue(new Error("We couldn't connect this bank account."));
    const r = await mount();
    await chooseNigeriaBank(r);
    await run(() => button(r, "Connect bank").props.onPress());
    await run(() => button(r, "Yes, connect this account").props.onPress());

    const notices = errorNotices(r);
    expect(notices).toHaveLength(1);
    expect(notices[0].props.text).toBe("We couldn't connect this bank account.");
    const confirm = button(r, "Yes, connect this account");
    expect(nextSibling(confirm) === notices[0] ? "under the button" : "elsewhere").toBe("under the button");
    expect(hostParentType(notices[0])).toBe("ProgramCard");
  });

  it("a refused account check shows its error directly under 'Connect bank'", async () => {
    mockCheckAccount.mockRejectedValue(new Error("We couldn't find that account."));
    const r = await mount();
    await chooseNigeriaBank(r);
    await run(() => button(r, "Connect bank").props.onPress());

    const notices = errorNotices(r);
    expect(notices).toHaveLength(1);
    expect(nextSibling(button(r, "Connect bank")) === notices[0] ? "under the button" : "elsewhere").toBe("under the button");
  });

  it("a refused secure-page connect shows its error directly under 'Connect bank'", async () => {
    mockConnectWithLink.mockRejectedValue(new Error("Bank onboarding is unavailable right now."));
    const r = await mount();
    const [countryField] = r.root.findAll((n) => (n.type as unknown) === "ChoiceField");
    await run(() => countryField.props.onChange("GB"));
    await run(() => button(r, "Connect bank").props.onPress());

    const notices = errorNotices(r);
    expect(notices).toHaveLength(1);
    expect(nextSibling(button(r, "Connect bank")) === notices[0] ? "under the button" : "elsewhere").toBe("under the button");
  });

  // #4402 E22: a creator sees the bank button for their own country; other countries sit behind "Paid in another currency?".
  it("shows one bank flow for the home country and the country list only after 'Paid in another currency?'", async () => {
    mockQueries["creator/own-profile"] = { data: { display_name: "Ada Obi", home_city: { countryCode: "NG" } }, isLoading: false, isError: false };
    const r = await mount();
    expect(r.root.findAll((n) => (n.type as unknown) === "ChoiceField").map((n) => n.props.label)).toEqual(["Bank"]);
    expect(button(r, "Connect bank")).toBeTruthy();
    await run(() => button(r, "Paid in another currency?").props.onPress());
    expect(r.root.findAll((n) => (n.type as unknown) === "ChoiceField").map((n) => n.props.label)).toEqual(["Country of your bank"]);
  });

  // #4402 E21: a bank name that shares no word with the profile name is flagged, and payouts are not blocked.
  it("warns when the account name does not match the profile name, and still allows connecting", async () => {
    mockQueries["creator/own-profile"] = { data: { display_name: "Ada Obi", home_city: { countryCode: "NG" } }, isLoading: false, isError: false };
    mockCheckAccount.mockResolvedValue({ account_name: "USEMINGLA LIMITED", account_number_masked: "******0000" });
    const r = await mount();
    const bankField = r.root.find((n) => (n.type as unknown) === "ChoiceField" && n.props.label === "Bank");
    await run(() => bankField.props.onChange("057"));
    const accountField = r.root.find((n) => (n.type as unknown) === "ProgramField");
    await run(() => accountField.props.onChangeText("0000000000"));
    await run(() => button(r, "Connect bank").props.onPress());
    const warning = r.root.findAll((n) => (n.type as unknown) === "ProgramNotice" && n.props.tone === "warning");
    expect(warning.map((n) => n.props.text)).toContain("We’ll check this account name with you before your first payout.");
    expect(button(r, "Yes, connect this account").props.disabled).toBeFalsy();
  });
});
