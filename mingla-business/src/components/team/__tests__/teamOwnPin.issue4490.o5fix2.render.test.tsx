/**
 * #4490 spec 08 O5 fix 2 (O5-B1): a signed-in member can set and change their
 * OWN Till PIN from Brand > Team, tapping their own row, on web and native.
 *
 *  1. The route: with the Till released, the "You" row is a live button and a
 *     tap opens the member sheet on "Set your PIN"; with the Till not released
 *     it stays informational (no dead tap: the row is disabled, not a no-op
 *     button). A solo operator (nobody else on the brand) still gets the row.
 *  2. The sheet on your own row is read-only: no role, venue-access, remove or
 *     disconnect control, for a venue_staff role too (the guard against
 *     changing your own role or permissions stays); the one control is the PIN.
 *  3. The PIN flow: a weak PIN is refused in plain words (client and the
 *     server's pin_weak), two matching PINs call the existing set-PIN action,
 *     and success closes the sheet and toasts "PIN saved".
 *  4. A manager's reset of ANOTHER member still works as built.
 *
 * Fails on revert: with `handleRowTap` back to ignoring "self" the first test
 * finds no PIN control; without `isSelf` the sheet shows "Remove from team".
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 teamOwnPin.issue4490.o5fix2
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: { bezier: () => () => 0, linear: () => 0, out: (fn: unknown) => fn, inOut: (fn: unknown) => fn, ease: () => 0, in: (fn: unknown) => fn, cubic: () => 0 },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withRepeat: (value: unknown) => value,
    withDelay: (_d: unknown, value: unknown) => value,
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});
jest.mock("expo-linear-gradient", () => {
  const RN = jest.requireActual("react-native");
  return { LinearGradient: RN.View };
});
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} }, manifest: null, executionEnvironment: "bare" } }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: "00000000-4490-4000-8000-0000000005c1" }),
  router: { push: jest.fn() },
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn(), auth: {}, channel: jest.fn(), removeChannel: jest.fn() },
}));

const BRAND = "00000000-4490-4000-8000-0000000005c1";
const ME = "00000000-4490-4000-8000-0000000005c2";

const mockReleased = { value: true };
jest.mock("../../../hooks/useTillReleased", () => ({ useTillReleased: () => mockReleased.value }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-4490-4000-8000-0000000005c2", email: "owner@harmattan.test" }, isAuthReady: true }),
}));
jest.mock("../../../hooks/useSwitchAccount", () => ({ useSwitchAccount: () => ({ signedInEmail: "owner@harmattan.test", onSwitchAccount: jest.fn() }) }));
// TEST-MOD-APPROVED #4490: 08-O5 fix 6 — the Team page waits for the role
// (isLoading / isAuthReady, as the real hook returns them) before it shows.
const mockRole = { role: "brand_owner" as string, rank: 60, isLoading: false, isAuthReady: true };
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => mockRole }));
// TEST-MOD-APPROVED #4490: 08-O5 fix 5 adds `pending` (the members query still loading).
const mockMembers: { rows: unknown[]; pending?: boolean } = { rows: [] };
jest.mock("../../../hooks/useBrandInvitations", () => ({
  useBrandInvitations: () => ({ data: [] }),
  useBrandTeamMembers: () => (mockMembers.pending === true ? { data: undefined, isPending: true } : { data: mockMembers.rows }),
  useRemoveBrandTeamMember: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRevokeBrandInvitation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandTeamMemberDirectory", () => ({ useBrandTeamMemberDirectory: () => ({ data: [] }) }));
jest.mock("../../../hooks/useBrandVenueAccessMutation", () => ({ useUpdateBrandTeamMemberVenueGrants: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "00000000-4490-4000-8000-0000000005c1", displayName: "Harmattan QA" }, isFetched: true, isLoading: false }),
}));
jest.mock("../../../hooks/useVenueListings", () => ({ useVenueListings: () => ({ data: [] }) }));
jest.mock("../../../hooks/useBrandPartnerLinks", () => ({ useBrandPartnerLinks: () => ({ data: [] }) }));
jest.mock("../../../hooks/usePartnerBrandLinkMutations", () => ({ useDisconnectLink: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock("../InviteBrandMemberSheet", () => ({ InviteBrandMemberSheet: () => null }));

const mockMine = jest.fn();
const mockSetPin = jest.fn();
const mockTeamPins = jest.fn();
const mockReset = jest.fn();
// #4490 venue owners: the PIN calls live in tillPinService (venueTillService
// re-exports them for the Till), so the Team sheet's calls are mocked there.
jest.mock("../../../services/tillPinService", () => {
  const actual = jest.requireActual("../../../services/tillPinService");
  return {
    ...actual,
    fetchMyTillPin: (...a: unknown[]) => mockMine(...a),
    setMyTillPin: (...a: unknown[]) => mockSetPin(...a),
    fetchTeamTillPins: (...a: unknown[]) => mockTeamPins(...a),
    resetTillPin: (...a: unknown[]) => mockReset(...a),
  };
});

import BrandTeamRoute from "../../../../app/brand/[id]/team";
import { MemberDetailSheet } from "../MemberDetailSheet";
import { TillError } from "../../../services/venueTillService";
import { MEMBER_SHEET_PIN_SNAP, rowTappable, showSelfRowAboveEmpty, TEAM_EMPTY_COPY, teamEmptyCopy } from "../teamRowModel";
import { PIN_COPY } from "../../venue/till/pinModel";
import { tillErrorCopy } from "../../venue/till/tillCopy";
import { SETTINGS_COPY } from "../../venue/close/dayCloseCopy";

const wrap = (el: React.ReactElement): React.ReactElement => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{el}</QueryClientProvider>;
};
const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const mounted: RenderTree[] = [];
async function mount(el: React.ReactElement): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(wrap(el));
  });
  mounted.push(tree as unknown as RenderTree);
  await flush();
  return tree as unknown as RenderTree;
}
const byId = (t: RenderTree, id: string): RenderTreeNode[] => t.root.findAll((n) => n.props.testID === id);
const pressable = (t: RenderTree, id: string): RenderTreeNode =>
  t.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];
const press = async (t: RenderTree, id: string): Promise<void> => {
  const target = pressable(t, id);
  expect({ id, found: target !== undefined }).toEqual({ id, found: true });
  await TestRenderer.act(async () => { (target.props.onPress as () => void)(); });
};
const allText = (t: RenderTree): string => JSON.stringify(t.root.findAll((n) => n.type === Text).map((n) => n.props.children));
const enterPin = async (t: RenderTree, padId: string, digits: string): Promise<void> => {
  for (const d of digits) await press(t, `${padId}-key-${d}`);
  await press(t, `${padId}-ok`);
};
const ownRow = (t: RenderTree): RenderTreeNode =>
  t.root.findAll((n) => n.props.accessibilityLabel === "owner@harmattan.test, Brand owner" && n.props.accessibilityRole === "button")[0];

jest.setTimeout(30_000);

const SELF = {
  id: `self_${ME}`, brandId: BRAND, inviteeEmail: "owner@harmattan.test", inviteeName: "owner@harmattan.test",
  role: "venue_staff" as const, venueGrants: [], status: "accepted" as const, invitedBy: ME,
  invitedAt: "2026-11-20T10:00:00Z", acceptedAt: "2026-11-20T10:00:00Z", removedAt: null,
};
const noopSheetProps = { currentRank: 60, onClose: jest.fn(), onRevoke: jest.fn(), onRemove: jest.fn() };

afterEach(async () => {
  while (mounted.length > 0) {
    const tree = mounted.pop() as RenderTree;
    await TestRenderer.act(async () => { tree.unmount(); });
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReleased.value = true;
  mockRole.role = "brand_owner";
  mockRole.rank = 60;
  mockMembers.rows = [];
  mockMine.mockResolvedValue({ memberId: "m-me", hasPin: false, setAt: null, hardLocked: false, tillDevice: false });
  mockTeamPins.mockResolvedValue([]);
  mockSetPin.mockResolvedValue(undefined);
  mockReset.mockResolvedValue(undefined);
});

describe("O5-B1 Settings > Selling in person points to where the control is", () => {
  test("it names Team and your own name, the place that now opens your PIN", () => {
    expect(SETTINGS_COPY.pinsBody).toContain("In Team, tap your own name to set your PIN");
  });
});

describe("O5-B1 the team row model", () => {
  test("your own row is live only while the Till is released; others always", () => {
    const self = { status: "self" as const, storeEntry: SELF };
    expect(rowTappable(self, true)).toBe(true);
    expect(rowTappable(self, false)).toBe(false);
    expect(rowTappable({ status: "self", storeEntry: null }, true)).toBe(false);
    expect(rowTappable({ status: "accepted", storeEntry: SELF }, false)).toBe(true);
    expect(rowTappable({ status: "pending", storeEntry: SELF }, false)).toBe(true);
  });
  test("a solo operator's own row shows above the empty state", () => {
    const self = { status: "self" as const, storeEntry: SELF };
    expect(showSelfRowAboveEmpty([self], true)).toBe(true);
    expect(showSelfRowAboveEmpty([self], false)).toBe(false);
    expect(showSelfRowAboveEmpty([], true)).toBe(false);
  });
});

describe("O5-B1 Brand > Team: tap your own row", () => {
  test("a solo owner (Till released): the You row is live, a tap opens Set your PIN, and nothing changes your role", async () => {
    const t = await mount(<BrandTeamRoute />);
    expect(allText(t)).toContain("You're working solo");
    const row = ownRow(t);
    expect(row).toBeDefined();
    expect(row.props.disabled).toBe(false);
    await TestRenderer.act(async () => { (row.props.onPress as () => void)(); });
    await flush();
    expect(byId(t, "till-pin-own").length).toBeGreaterThan(0);
    expect(pressable(t, "till-pin-set")).toBeDefined();
    expect(allText(t)).toContain(PIN_COPY.setPin);
    // read-only: no remove / revoke / venue access controls on your own row
    expect(allText(t)).not.toContain("Remove from team");
    expect(allText(t)).not.toContain("Revoke invitation");
    expect(byId(t, "member-detail-save-venue-access")).toHaveLength(0);
  });

  test("Till not released: your own row is informational (disabled), never a tap that does nothing", async () => {
    mockReleased.value = false;
    mockMembers.rows = [{
      id: "m2", brand_id: BRAND, user_id: "u2", role: "event_manager", invited_at: "2026-11-01T10:00:00Z",
      accepted_at: "2026-11-02T10:00:00Z", removed_at: null, venueGrants: [],
    }];
    const t = await mount(<BrandTeamRoute />);
    const row = ownRow(t);
    expect(row).toBeDefined();
    expect(row.props.disabled).toBe(true);
  });
});

describe("O5-B1 the sheet on your own row", () => {
  test("a venue_staff member sees no venue access editor, remove or role control, only the PIN and Close", async () => {
    const t = await mount(<MemberDetailSheet visible entry={SELF} isSelf {...noopSheetProps} />);
    expect(byId(t, "till-pin-own").length).toBeGreaterThan(0);
    const text = allText(t);
    expect(text).toContain("This is you");
    expect(text).not.toContain("Remove from team");
    expect(text).not.toContain("Save venue access");
    expect(text).toContain("Close");
  });

  test("a weak PIN is refused in plain words, before the server and by the server (pin_weak)", async () => {
    const t = await mount(<MemberDetailSheet visible entry={SELF} isSelf {...noopSheetProps} />);
    await press(t, "till-pin-set");
    await enterPin(t, "till-pin-choose", "0000");
    expect(allText(t)).toContain(PIN_COPY.weak);
    expect(mockSetPin).not.toHaveBeenCalled();
    // a PIN the app lets through but the server calls weak: the same sentence comes back
    mockSetPin.mockRejectedValueOnce(new TillError("pin_weak"));
    await enterPin(t, "till-pin-choose", "2468");
    await enterPin(t, "till-pin-confirm", "2468");
    await flush();
    expect(allText(t)).toContain(tillErrorCopy("pin_weak"));
    expect(byId(t, "till-pin-choose").length).toBeGreaterThan(0);
    expect(tillErrorCopy("pin_weak")).toBe(PIN_COPY.weak);
  });

  test("two matching PINs call the set-PIN action once and report saved", async () => {
    const saved = jest.fn();
    const t = await mount(<MemberDetailSheet visible entry={SELF} isSelf onOwnPinSaved={saved} {...noopSheetProps} />);
    await press(t, "till-pin-set");
    await enterPin(t, "till-pin-choose", "4826");
    await enterPin(t, "till-pin-confirm", "4826");
    await flush();
    expect(mockSetPin).toHaveBeenCalledTimes(1);
    expect(mockSetPin).toHaveBeenCalledWith({ brandId: BRAND, pin: "4826" });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(allText(t)).not.toContain("4826");
  });

  test("a different second PIN starts again and never calls the server", async () => {
    const t = await mount(<MemberDetailSheet visible entry={SELF} isSelf {...noopSheetProps} />);
    await press(t, "till-pin-set");
    await enterPin(t, "till-pin-choose", "4826");
    await enterPin(t, "till-pin-confirm", "4827");
    expect(mockSetPin).not.toHaveBeenCalled();
    expect(allText(t)).toContain(PIN_COPY.mismatch);
  });

  test("the sign-in cannot be read: say so with a way forward, never an empty sheet", async () => {
    mockMine.mockRejectedValue(new TillError("till_failed"));
    const t = await mount(<MemberDetailSheet visible entry={SELF} isSelf {...noopSheetProps} />);
    expect(byId(t, "till-pin-own-error").length).toBeGreaterThan(0);
    expect(pressable(t, "till-pin-own-retry")).toBeDefined();
  });
});

describe("O5-B1 a manager's reset of another member still works", () => {
  test("Reset {name}'s PIN calls the existing reset action for that membership", async () => {
    const OTHER = { ...SELF, id: "m-other", inviteeName: "Ada", inviteeEmail: "ada@x.test", role: "event_manager" as const, invitedBy: "u2" };
    mockTeamPins.mockResolvedValue([{ memberId: "m-other", name: "Ada", hasPin: true, setAt: "2026-11-20T10:00:00Z", hardLocked: false, lockedUntil: null }]);
    const t = await mount(<MemberDetailSheet visible entry={OTHER} {...noopSheetProps} />);
    expect(byId(t, "till-pin-member").length).toBeGreaterThan(0);
    await press(t, "till-pin-reset");
    await flush();
    expect(mockReset).toHaveBeenCalledWith("m-other");
    expect(allText(t)).toContain(PIN_COPY.resetDone);
  });
});

// #4490 08-O5 fix 4 (device pass at d20ce4857e). Fails on revert: with the
// sheet back on snapPoint "half" (no memberSheetSnap / onPinPadChange) the
// first test reads "half"; with the empty state back to "You're working solo"
// for everyone the second finds the solo words on a staff member's page.
describe("08-O5 fix 4: the Set your PIN sheet and a staff member's Team page", () => {
  const sheetSnap = (t: RenderTree): unknown =>
    t.root.findAll((n) => n.props.testID === "member-detail-sheet" && n.props.snapPoint !== undefined)[0]?.props.snapPoint;

  test("opening the PIN pad makes the sheet the pad at full height (keypad, OK and Close fit); Cancel brings it back", async () => {
    const t = await mount(<MemberDetailSheet visible entry={SELF} isSelf {...noopSheetProps} />);
    expect(sheetSnap(t)).toBe("half");
    await press(t, "till-pin-set");
    expect(sheetSnap(t)).toBe(MEMBER_SHEET_PIN_SNAP);
    expect(MEMBER_SHEET_PIN_SNAP).toBeGreaterThanOrEqual(0.9);
    const text = allText(t);
    expect(text).not.toContain("This is you");
    expect(text).not.toContain("What this role does");
    expect(pressable(t, "till-pin-choose-ok")).toBeDefined();
    expect(text).toContain("Close");
    const cancel = t.root.findAll((n) => n.props.label === PIN_COPY.cancel && typeof n.props.onPress === "function")[0];
    await TestRenderer.act(async () => { (cancel.props.onPress as () => void)(); });
    expect(sheetSnap(t)).toBe("half");
    expect(allText(t)).toContain("This is you");
  });

  test("a staff member who cannot invite sees who manages the team, not 'You're working solo'", async () => {
    mockRole.role = "venue_staff";
    mockRole.rank = -1;
    const t = await mount(<BrandTeamRoute />);
    const text = allText(t);
    expect(text).not.toContain("You're working solo");
    expect(text).toContain(TEAM_EMPTY_COPY.staffTitle);
    expect(teamEmptyCopy(true).title).toBe("You're working solo");
  });
});

// #4490 08-O5 fix 5 (item 9). Fails on revert: without teamListState's
// loading branch in the Team route the page shows "You're working solo" while
// the members are still loading.
describe("08-O5 fix 5: the Team page waits for its members", () => {
  afterEach(() => {
    mockMembers.pending = false;
    mockRole.role = "brand_owner";
    mockRole.rank = 60;
  });

  test("while the members load: a loading list, never 'You're working solo'; loaded with nobody else: the empty state", async () => {
    mockRole.role = "brand_owner";
    mockRole.rank = 60;
    mockMembers.pending = true;
    const loading = await mount(<BrandTeamRoute />);
    expect(loading.root.findAll((n) => n.props.testID === "team-loading").length).toBeGreaterThan(0);
    expect(allText(loading)).not.toContain("You're working solo");
    mockMembers.pending = false;
    const loaded = await mount(<BrandTeamRoute />);
    expect(loaded.root.findAll((n) => n.props.testID === "team-loading")).toHaveLength(0);
    expect(allText(loaded)).toContain("You're working solo");
  });
});
