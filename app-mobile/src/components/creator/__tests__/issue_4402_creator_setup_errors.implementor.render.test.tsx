/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4402 — Creator setup never fails out of sight.
 *
 *   - Profile: a failed Save shows its error beside the Save button (in the
 *     screen footer), not at the bottom of the scroll where the tap looked dead.
 *   - Rates, no profile yet: the step says to save the profile first and offers
 *     the way there, instead of a Save rate that failed with nothing on screen.
 *   - Rates, profile saved: a failed Save rate shows its error beside the
 *     button in the sheet footer, with the server's named refusal in plain words.
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

type QueryResult = { data?: unknown; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void };
const mockQueries: Record<string, QueryResult> = {};
const mockPush = jest.fn();
const mockSaveProfile = jest.fn();
const mockSavePackage = jest.fn();
const mockGoToNextStep = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    mockQueries[queryKey.join("/")] ?? { data: undefined, isLoading: false, isError: false, refetch: jest.fn() },
  useQueryClient: () => ({ invalidateQueries: jest.fn(() => Promise.resolve()), fetchQuery: jest.fn() }),
}));

jest.mock("../../../services/creatorProgramService", () => ({
  CREATOR_NICHES: ["food", "music"],
  CREATOR_LANGUAGES: ["English", "French"],
  creatorProgramService: {
    ownProfile: jest.fn(),
    status: jest.fn(),
    saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
    setHomeCity: jest.fn(),
    savePackage: (...args: unknown[]) => mockSavePackage(...args),
  },
}));

jest.mock("../../../services/payoutService", () => ({
  payoutService: { status: jest.fn() },
  payoutCountry: () => null,
}));

jest.mock("../setupNav", () => ({
  SETUP_STATUS_KEY: ["creator", "status"],
  goToNextStep: (...args: unknown[]) => mockGoToNextStep(...args),
  stepTitle: (step: string) => step,
}));

jest.mock("../HomeCityField", () => {
  const ReactActual = jest.requireActual("react");
  return { HomeCityField: (props: Record<string, unknown>) => ReactActual.createElement("HomeCityField", props) };
});

jest.mock("../../programs/ProgramPickers", () => {
  const ReactActual = jest.requireActual("react");
  return { Chip: (props: Record<string, unknown>) => ReactActual.createElement("Chip", props) };
});

// The shared program UI as plain host elements: the screen keeps its scroll
// body and its sticky footer apart, so the test can tell WHERE an error lands.
jest.mock("../../programs/ProgramUi", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  const host = (name: string) => (props: Record<string, unknown>) => h(name, props, props.children as React.ReactNode);
  return {
    programStyles: {},
    PROGRAM_COLORS: {},
    ProgramScreen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      h("Screen", null, h("ScreenBody", null, children), footer ? h("ScreenFooter", null, footer) : null),
    ProgramSheet: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
      visible ? h("Sheet", null, h("SheetBody", null, children), footer ? h("SheetFooter", null, footer) : null) : null,
    ProgramButton: host("ProgramButton"),
    ProgramField: host("ProgramField"),
    ProgramLoading: host("ProgramLoading"),
    ProgramLoadError: host("ProgramLoadError"),
    ProgramNotice: host("ProgramNotice"),
    ProgramCard: host("ProgramCard"),
    ProgramRow: host("ProgramRow"),
  };
});

const { ProgramActionError } = require("../../../services/programResult");
const CreatorProfileStep = require("../../../../app/creator/setup/profile").default;
const CreatorRatesStep = require("../../../../app/creator/setup/rates").default;

type Renderer = import("react-test-renderer").ReactTestRenderer;
type Instance = import("react-test-renderer").ReactTestInstance;

async function press(target: Instance): Promise<void> {
  await act(async () => {
    target.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function ok(data: unknown): QueryResult {
  return { data, isLoading: false, isError: false, refetch: jest.fn() };
}

async function mount(element: React.ReactElement): Promise<Renderer> {
  let renderer: Renderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  if (!renderer) throw new Error("did not render");
  return renderer;
}

function notices(root: Instance, tone?: string): Instance[] {
  return root.findAll((n) => (n.type as unknown) === "ProgramNotice" && (tone === undefined || n.props.tone === tone));
}

function button(root: Instance, label: string): Instance {
  return root.find((n) => (n.type as unknown) === "ProgramButton" && n.props.label === label);
}

function only(root: Instance, type: string): Instance {
  return root.find((n) => (n.type as unknown) === type);
}

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockPush.mockReset();
  mockSaveProfile.mockReset();
  mockSavePackage.mockReset();
  mockGoToNextStep.mockReset();
});

describe("#4402 profile step", () => {
  beforeEach(() => {
    mockQueries["creator/own-profile"] = ok({
      display_name: "Ada Films", bio: "", niches: ["food"], languages: ["English"], home_city: null, date_of_birth: null,
    });
    mockQueries["creator/status"] = ok({ profile: false });
  });

  it("a refused Save shows the error beside the Save button, not in the scroll body", async () => {
    mockSaveProfile.mockRejectedValue(new ProgramActionError("creator_account_required"));
    const r = await mount(React.createElement(CreatorProfileStep));
    const save = button(r.root, "Save and continue");
    expect(save.props.disabled).toBe(false);
    await press(save);

    const footer = only(r.root, "ScreenFooter");
    const body = only(r.root, "ScreenBody");
    const footerErrors = notices(footer, "error");
    expect(footerErrors).toHaveLength(1);
    expect(footerErrors[0].props.text).toBe(
      new ProgramActionError("creator_account_required").message,
    );
    expect(notices(body, "error")).toHaveLength(0);
    expect(mockGoToNextStep).not.toHaveBeenCalled();
  });

  it("an unexpected failure is still shown beside the button in plain words", async () => {
    mockSaveProfile.mockRejectedValue(new Error("insert or update on table violates foreign key constraint"));
    const r = await mount(React.createElement(CreatorProfileStep));
    await press(button(r.root, "Save and continue"));
    const footerErrors = notices(only(r.root, "ScreenFooter"), "error");
    expect(footerErrors).toHaveLength(1);
    expect(footerErrors[0].props.text).not.toMatch(/foreign key|constraint/);
  });

  it("no error is shown before a save is attempted", async () => {
    const r = await mount(React.createElement(CreatorProfileStep));
    expect(notices(r.root, "error")).toHaveLength(0);
  });
});

describe("#4402 rates step", () => {
  it("without a saved profile, says so and leads to the profile instead of offering Save rate", async () => {
    mockQueries["creator/status"] = ok({ profile: false, packages: [] });
    const r = await mount(React.createElement(CreatorRatesStep));
    const warning = notices(only(r.root, "ScreenBody"), "warning");
    expect(warning).toHaveLength(1);
    expect(warning[0].props.text).toBe("Save your profile first, then come back to this step.");
    expect(r.root.findAll((n) => (n.type as unknown) === "ProgramRow")).toHaveLength(0);
    await act(async () => {
      button(only(r.root, "ScreenFooter"), "Go to your profile").props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith("/creator/setup/profile");
    expect(mockSavePackage).not.toHaveBeenCalled();
  });

  it("a status read that fails shows a retryable error, not the no-profile message", async () => {
    mockQueries["creator/status"] = { data: undefined, isLoading: false, isError: true, error: new Error("network request failed"), refetch: jest.fn() };
    const r = await mount(React.createElement(CreatorRatesStep));
    expect(r.root.findAll((n) => (n.type as unknown) === "ProgramLoadError")).toHaveLength(1);
    expect(notices(r.root, "warning")).toHaveLength(0);
  });

  it("with a profile, a refused Save rate shows the named error beside the button", async () => {
    mockQueries["creator/status"] = ok({ profile: true, packages: [] });
    mockSavePackage.mockRejectedValue(new Error("creator_profile_required"));
    const r = await mount(React.createElement(CreatorRatesStep));
    const rows = r.root.findAll((n) => (n.type as unknown) === "ProgramRow");
    expect(rows.length).toBeGreaterThan(0);
    await act(async () => {
      rows[0].props.onPress();
    });
    const price = r.root.find((n) => (n.type as unknown) === "ProgramField" && n.props.label === "Your price");
    await act(async () => {
      price.props.onChangeText("300");
    });
    await press(button(only(r.root, "SheetFooter"), "Save rate"));
    expect(mockSavePackage).toHaveBeenCalledTimes(1);
    const footerErrors = notices(only(r.root, "SheetFooter"), "error");
    expect(footerErrors).toHaveLength(1);
    expect(footerErrors[0].props.text).toBe("Save your profile first, then come back to this step.");
    expect(notices(only(r.root, "SheetBody"), "error")).toHaveLength(0);
  });
});
