/* eslint-disable import/first */
// issue #3284 [refund terms on events and experiences] — implementor happy-path
// regression for the EVENT half (spec part 2 §C2, §C3; design §4.1, §4.3–4.5).
//
// WHAT THIS FILE PINS
//   ED-*  the shared RefundPolicyEditor: event presets + "No refunds" (E2/E3), the
//         empty helper (E4), the tier accessibility noun (E5), the chip slop (E6),
//         AA error text (E10) — and trips keeping their three month-scaled chips.
//   CR-*  the CREATE wizard: Settings opens with the refund card (helper, sales
//         banner), the Settings subtitle, Settings validation blocks bad tiers,
//         the persisted draft backfills v13→v14, the terms round-trip through the
//         saved draft, and publish writes the terms FIRST and fails closed.
//   EP-*  the EDIT-PUBLISHED wizard: the by-id probe maps refund_policy, the
//         adapter maps / diffs / names it as a material change, and the REAL
//         EditPublishedScreen save calls the gated owner before any other write —
//         "Refund first" on a downgrade, a toast when unavailable, and on success
//         the key never reaches the atomic live-event write.
//
// FAILS-ON-REVERT: restore RefundPolicyEditor.tsx, CreatorStep6Settings.tsx,
// EventCreatorWizard.tsx, draftEventValidation.ts, draftEventStore.ts,
// serverDraftEventMapper.ts, businessEvents.ts, liveEventAdapter.ts or
// EditPublishedScreen.tsx from origin/main and the matching block goes red.

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestInstance | string>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// module boundaries (network + native leaves only; product logic stays real)
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const mockFrom = jest.fn<(table: string) => unknown>();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));
jest.mock("../../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("GlassCardProbe", props, props.children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ConfirmDialogProbe", props),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToastProbe", props),
}));
jest.mock("../ChangeSummaryModal", () => ({
  ChangeSummaryModal: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ChangeSummaryModalProbe", props),
}));
jest.mock("../CreatorStep1Basics", () => ({ CreatorStep1Basics: (): null => null }));
jest.mock("../CreatorStep2When", () => ({ CreatorStep2When: (): null => null }));
jest.mock("../CreatorStep3Where", () => ({ CreatorStep3Where: (): null => null }));
jest.mock("../CreatorStep4Cover", () => ({ CreatorStep4Cover: (): null => null }));
jest.mock("../CreatorStep5Tickets", () => ({ CreatorStep5Tickets: (): null => null }));
jest.mock("../EditAfterPublishBanner", () => ({ EditAfterPublishBanner: (): null => null }));
jest.mock("../EventTicketCheckoutAccessCard", () => ({
  EventTicketCheckoutAccessCard: (): null => null,
}));
jest.mock("../../theme/ThemeControlRow", () => ({ ThemeControlRow: (): null => null }));
jest.mock("../../theme/ThemeSheet", () => ({ ThemeSheet: (): null => null }));
jest.mock("../../rsvp/RsvpStep5Setup", () => ({ RsvpStep5Setup: (): null => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return {
    ScrollView: R.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      R.createElement("ScrollView", { ...props, ref }, props.children),
    ),
  };
});
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual<Record<string, unknown>>("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../../hooks/useBusinessEvents", () => ({
  businessEventKeys: {
    detail: (id: string) => ["business-event", id],
    list: (id: string) => ["business-events", id],
  },
}));
jest.mock("../../../hooks/usePublicEvents", () => ({
  publicEventKeys: {
    detailById: (id: string) => ["public-event", id],
    detailBySlug: (a: string, b: string) => ["public-event", a, b],
    brandBySlug: (a: string) => ["public-brand", a],
  },
}));
const mockOrdersRead = { status: "ready", data: [], refetch: jest.fn() };
jest.mock("../../../hooks/useEventOrders", () => ({
  useEventReconciliation: () => mockOrdersRead,
  useEventHasWebPurchases: () => false,
}));
const mockSoldCtx = { soldCountByTier: { "ticket-ga": 3 }, soldCountForEvent: 3 };
jest.mock("../../../services/eventOrdersService", () => ({
  buildSoldCountContextFromOrders: () => mockSoldCtx,
}));
jest.mock("../../../services/orderRefundService", () => ({
  refundAllEventOrders: jest.fn(),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: null, isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({ data: undefined }),
}));
jest.mock("../../../services/eventCoverMediaService", () => ({
  attestEventCoverSelection: jest.fn(),
  EventCoverMediaError: class EventCoverMediaError extends Error {},
}));
jest.mock("../../../services/pricingSwitchesService", () => ({
  refreshBrandTaxRegistrationAttestation: jest.fn(),
}));
jest.mock("../../../services/rsvpEvents", () => ({ updateLiveRsvp: jest.fn() }));
jest.mock("../../../utils/rsvpHubMetrics", () => ({ rsvpEditNoticeCopy: () => "" }));
const mockUpdateLiveEventFields = jest.fn(() => ({ ok: true, editLogEntryId: "log-1" }));
jest.mock("../../../store/liveEventStore", () => ({
  useLiveEventStore: (selector: (s: unknown) => unknown) =>
    selector({ updateLiveEventFields: mockUpdateLiveEventFields }),
}));

import { semantic } from "../../../constants/designSystem";
import { PARTY_TYPE_SLUGS } from "../../../constants/eventTaxonomy";
import {
  EVENT_FLEXIBLE_POLICY,
  EVENT_STANDARD_POLICY,
  EVENT_STRICT_POLICY,
  FLEXIBLE_POLICY,
  NO_REFUNDS_POLICY,
  type RefundPolicy,
} from "../../../services/refundPolicyService";
import {
  fetchBusinessEventById,
  publishBusinessEventDraft,
} from "../../../services/businessEvents";
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
  type TicketStub,
} from "../../../store/draftEventStore";
import type { LiveEvent } from "../../../store/liveEventStore";
import { validateStep } from "../../../utils/draftEventValidation";
import {
  MATERIAL_KEYS,
  classifySeverity,
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../../../utils/liveEventAdapter";
import {
  OfferingRefundTermsError,
  REFUND_TERMS_UNAVAILABLE_COPY,
} from "../../../utils/refundPolicyTerms";
import {
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../../../utils/serverDraftEventMapper";
import { RefundPolicyEditor } from "../../trip/RefundPolicyEditor";
import { CreatorStep6Settings } from "../CreatorStep6Settings";
import { EditPublishedScreen } from "../EditPublishedScreen";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const collectText = (node: unknown, out: string[] = []): string[] => {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  collectText((node as { children?: unknown }).children, out);
  return out;
};
const textOf = (tree: Renderer): string => collectText(tree.toJSON()).join("\n");

const host = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === type);

const byTestId = (tree: Renderer, testID: string): TestInstance => {
  const found = tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};

const flattenStyle = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flattenStyle))
    : style !== null && typeof style === "object"
      ? (style as Record<string, unknown>)
      : {};

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

const press = async (node: TestInstance): Promise<void> => {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const readSource = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", rel), "utf8");

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-ga",
  name: "General admission",
  priceGbp: 25,
  capacity: 100,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...overrides,
});

const draft = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent("brand-3284", "f1ba5ee0-6a6b-4bb8-8a4c-7a89ea8b3284", "2026-09-14T10:00:00.000Z"),
  name: "Rooftop Sessions",
  tickets: [ticket()],
  ...overrides,
});

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockRouter.push.mockClear();
  mockUpdateLiveEventFields.mockClear();
});

// ===========================================================================
// ED — the shared editor
// ===========================================================================

describe("ED — RefundPolicyEditor on an event (E1–E12)", () => {
  test("ED-1 events get Flexible · Standard · Strict · No refunds backed by the day-scaled presets", async () => {
    const onChange = jest.fn();
    const tree = await mount(
      <RefundPolicyEditor offeringType="event" value={null} onChange={onChange} />,
    );
    const chips = host(tree, "Pressable").filter((n) =>
      String(n.props.testID ?? "").startsWith("refund-policy-chip-"),
    );
    expect(chips.map((c) => c.props.accessibilityLabel)).toEqual([
      "Flexible refund policy template",
      "Standard refund policy template",
      "Strict refund policy template",
      "No refunds refund policy template",
    ]);
    await press(byTestId(tree, "refund-policy-chip-flexible"));
    expect(onChange).toHaveBeenLastCalledWith(EVENT_FLEXIBLE_POLICY);
    await press(byTestId(tree, "refund-policy-chip-no_refunds"));
    expect(onChange).toHaveBeenLastCalledWith(NO_REFUNDS_POLICY);
    // E4 — the event empty helper.
    expect(textOf(tree)).toContain(
      "Pick a template or build your own. If you leave this empty, paid guests are told no policy is set.",
    );
    // E6 — split slop so neighbouring chips meet in the 8pt gap.
    expect(chips[0].props.hitSlop).toEqual({ top: 8, bottom: 8, left: 4, right: 4 });
  });

  test("ED-2 'No refunds' is its own selected state: no Custom chip, plain body, builder seeds from Standard", async () => {
    const onChange = jest.fn();
    const tree = await mount(
      <RefundPolicyEditor offeringType="event" value={NO_REFUNDS_POLICY} onChange={onChange} />,
    );
    const noRefundsChip = byTestId(tree, "refund-policy-chip-no_refunds");
    expect(noRefundsChip.props.accessibilityState).toEqual({ selected: true });
    const text = textOf(tree);
    expect(text).toContain("Guests can't get a refund after they buy.");
    expect(text).not.toContain("Custom");
    expect(text).not.toContain("If they cancel:");
    const build = host(tree, "Pressable").find(
      (n) => n.props.accessibilityLabel === "Build custom tiers",
    );
    expect(build).toBeDefined();
    await press(build as TestInstance);
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "custom",
      tiers: EVENT_STANDARD_POLICY.tiers,
    });
  });

  test("ED-3 tier inputs name the event and error text uses the AA errorText token", async () => {
    expect(semantic.errorText).toBe("#f87171");
    const invalid: RefundPolicy = {
      kind: "custom",
      tiers: [
        { days_before_start: 7, refund_pct: 100 },
        { days_before_start: 9, refund_pct: 50 },
      ],
    };
    const tree = await mount(
      <RefundPolicyEditor offeringType="event" value={invalid} onChange={jest.fn()} />,
    );
    const inputs = host(tree, "TextInput");
    expect(inputs[0].props.accessibilityLabel).toBe("Tier 1 days before event start");
    expect(inputs[0].props.accessibilityHint).toBe(
      "Number of days before the event when this tier applies",
    );
    expect(flattenStyle(inputs[0].props.style).minHeight).toBe(44);
    const error = host(tree, "Text").find(
      (n) => collectText(n.props.children).join("") === "Days must count down. Previous tier is 7.",
    );
    expect(error).toBeDefined();
    expect(flattenStyle((error as TestInstance).props.style).color).toBe("#f87171");
  });

  test("ED-4 trips keep their three month-scaled chips and shipped copy", async () => {
    const onChange = jest.fn();
    const tree = await mount(<RefundPolicyEditor value={null} onChange={onChange} />);
    const chips = host(tree, "Pressable").filter((n) =>
      String(n.props.testID ?? "").startsWith("refund-policy-chip-"),
    );
    expect(chips).toHaveLength(3);
    expect(textOf(tree)).toContain(
      "Pick a template or build custom tiers. Set to none for no refunds.",
    );
    await press(byTestId(tree, "refund-policy-chip-flexible"));
    expect(onChange).toHaveBeenLastCalledWith(FLEXIBLE_POLICY);
  });
});

// ===========================================================================
// CR — the create wizard
// ===========================================================================

describe("CR — event create wizard: Settings, validation, draft, publish", () => {
  const renderSettings = (
    props: { draft: DraftEvent; soldCountByTier?: Record<string, number> },
    updateDraft: (patch: Partial<DraftEvent>) => void = jest.fn(),
  ): Promise<Renderer> =>
    mount(
      <CreatorStep6Settings
        draft={props.draft}
        updateDraft={updateDraft}
        errors={[]}
        showErrors={false}
        onShowToast={jest.fn()}
        scrollToBottom={jest.fn()}
        editMode={
          props.soldCountByTier === undefined
            ? undefined
            : { soldCountByTier: props.soldCountByTier }
        }
      />,
    );

  test("CR-1 Settings renders the refund card FIRST, wired to the draft, with the paid helper", async () => {
    const updateDraft = jest.fn();
    const tree = await renderSettings({ draft: draft({ refundPolicy: EVENT_STRICT_POLICY }) }, updateDraft);
    const text = textOf(tree);
    expect(text.indexOf("REFUND POLICY")).toBeGreaterThan(-1);
    expect(text.indexOf("REFUND POLICY")).toBeLessThan(text.indexOf("Visibility"));
    expect(byTestId(tree, "event-settings-refund-card")).toBeDefined();
    const editor = tree.root.findAll((n) => n.type === RefundPolicyEditor);
    expect(editor).toHaveLength(1);
    expect(editor[0].props.offeringType).toBe("event");
    expect(editor[0].props.value).toEqual(EVENT_STRICT_POLICY);
    expect(collectText(byTestId(tree, "event-settings-refund-helper").props.children).join("")).toBe(
      "Guests see these terms before they buy. You issue refunds from Orders — Mingla doesn't refund automatically yet.",
    );
    expect(tree.root.findAll((n) => n.props.testID === "event-settings-refund-sales-banner")).toHaveLength(0);
    await press(byTestId(tree, "refund-policy-chip-standard"));
    expect(updateDraft).toHaveBeenLastCalledWith({ refundPolicy: EVENT_STANDARD_POLICY });
  });

  test("CR-2 all-free tickets switch the helper; sold tickets show the can't-make-worse banner", async () => {
    const free = await renderSettings({
      draft: draft({ tickets: [ticket({ isFree: true, priceGbp: null })] }),
    });
    expect(textOf(free)).toContain(
      "All your tickets are free, so guests won't see this until you add a paid ticket.",
    );
    expect(free.root.findAll((n) => n.props.testID === "event-settings-refund-sales-banner")).toHaveLength(0);
    const sold = await renderSettings({ draft: draft(), soldCountByTier: { "ticket-ga": 38 } });
    expect(byTestId(sold, "event-settings-refund-sales-banner")).toBeDefined();
    expect(textOf(sold)).toContain(
      "38 guests already bought under these terms. More-generous refunds or an extra tier save instantly — but you can't make terms worse for them here.",
    );
  });

  test("CR-3 the Settings subtitle names refunds, and the wizard surfaces a refund-terms publish failure", () => {
    const wizard = readSource("src/components/event/EventCreatorWizard.tsx");
    expect(wizard).toContain('{ title: "Settings", subtitle: "Refunds, visibility, approvals" }');
    expect(wizard).not.toContain("Visibility, approvals, transfers");
    expect(wizard).toMatch(
      /if \(error instanceof OfferingRefundTermsError\) \{\s*handleShowToast\(error\.message\);/,
    );
  });

  test("CR-4 Settings validation blocks an invalid tier and never blocks 'no terms'", () => {
    expect(validateStep(5, draft({ refundPolicy: null }))).toEqual([]);
    expect(validateStep(5, draft({ refundPolicy: EVENT_FLEXIBLE_POLICY }))).toEqual([]);
    const errors = validateStep(
      5,
      draft({
        refundPolicy: {
          kind: "custom",
          tiers: [
            { days_before_start: 7, refund_pct: 50 },
            { days_before_start: 2, refund_pct: 80 },
          ],
        },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].fieldKey).toBe("refundPolicy");
    expect(errors[0].step).toBe(5);
  });

  test("CR-5 the persisted draft store is v14 and backfills a missing refund policy as null", async () => {
    const options = useDraftEventStore.persist.getOptions();
    expect(options.version).toBe(14);
    const legacy = draft({ refundPolicy: undefined });
    delete (legacy as { refundPolicy?: unknown }).refundPolicy;
    const kept = draft({ id: "d_kept", refundPolicy: EVENT_STRICT_POLICY });
    const migrated = (await options.migrate?.({ drafts: [legacy, kept] }, 13)) as {
      drafts: DraftEvent[];
    };
    expect(Object.prototype.hasOwnProperty.call(migrated.drafts[0], "refundPolicy")).toBe(true);
    expect(migrated.drafts[0].refundPolicy).toBeNull();
    expect(migrated.drafts[1].refundPolicy).toEqual(EVENT_STRICT_POLICY);
    expect(buildDraftEvent("brand-1").refundPolicy).toBeNull();
  });

  test("CR-6 the refund terms survive the autosave echo (business_draft round-trip)", () => {
    const source = draft({ refundPolicy: EVENT_STANDARD_POLICY });
    const update = draftToServerUpdate(source, {});
    const row: ServerDraftEventRow = {
      ...update,
      theme: JSON.parse(JSON.stringify(update.theme)) as Record<string, unknown>,
      id: source.id,
      brand_id: source.brandId,
      created_by: "user-1",
      slug: "draft-3284",
      created_at: source.createdAt,
      updated_at: source.updatedAt,
      published_at: null,
      deleted_at: null,
    } as ServerDraftEventRow;
    expect(serverRowToDraft(row).refundPolicy).toEqual(EVENT_STANDARD_POLICY);
    const legacyTheme = JSON.parse(JSON.stringify(update.theme)) as {
      business_draft: Record<string, unknown>;
    };
    delete legacyTheme.business_draft.refundPolicy;
    expect(serverRowToDraft({ ...row, theme: legacyTheme }).refundPolicy).toBeNull();
  });

  test("CR-9 the organiser draft preview shows the draft's own terms (slice B's transitional marker resolved)", () => {
    const preview = readSource("src/components/event/DraftEventFoundationPreview.tsx");
    expect(preview).not.toContain("[TRANSITIONAL] issue #3284");
    expect(preview).not.toContain("refundPolicyState={UNKNOWN_REFUND_POLICY_STATE}");
    expect(preview).toContain("readRefundPolicyState({ refundPolicy })");
    expect(preview).toContain("refundPolicy: RefundPolicy | null;");
    const route = readSource("app/event/[id]/preview.tsx");
    expect(route).toContain("refundPolicy={draft.refundPolicy ?? null}");
  });

  const publishResponse = (id: string) => ({
    event: {
      id,
      brand_id: "brand-3284",
      created_by: "user-1",
      title: "Rooftop Sessions",
      description: "",
      slug: "rooftop-sessions",
      location_text: null,
      online_url: null,
      is_online: false,
      is_recurring: false,
      is_multi_date: false,
      recurrence_rules: null,
      cover_media_url: null,
      cover_media_type: null,
      currency: "GBP",
      visibility: "public",
      status: "scheduled",
      published_at: "2026-09-14T10:30:00.000Z",
      timezone: "Europe/London",
      created_at: "2026-09-14T10:00:00.000Z",
      updated_at: "2026-09-14T10:30:00.000Z",
      theme: { business_event: { settings: {} } },
    },
    brand: { id: "brand-3284", slug: "sunset", name: "Sunset Collective" },
    tickets: [],
    client_revision: null,
  });

  test("CR-7 publish writes the refund terms through the gated owner BEFORE the publish RPC", async () => {
    const source = draft({ refundPolicy: EVENT_STANDARD_POLICY });
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? { data: { ok: true, refundPolicy: EVENT_STANDARD_POLICY, changed: true }, error: null }
        : { data: publishResponse(source.id), error: null },
    );
    await publishBusinessEventDraft(source);
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual([
      "business_patch_offering_refund_policy",
      "issue_1719_publish_event_with_poster",
    ]);
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_event_id: source.id,
      p_policy: EVENT_STANDARD_POLICY,
      p_reason: null,
    });
  });

  test("CR-8 publish fails CLOSED when the terms do not save, and makes no call when there are none", async () => {
    const source = draft({ refundPolicy: EVENT_STRICT_POLICY });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    let thrown: unknown = null;
    try {
      await publishBusinessEventDraft(source);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OfferingRefundTermsError);
    expect((thrown as OfferingRefundTermsError).message).toBe(REFUND_TERMS_UNAVAILABLE_COPY);
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(["business_patch_offering_refund_policy"]);

    mockRpc.mockReset();
    const noTerms = draft({ refundPolicy: null });
    mockRpc.mockResolvedValue({ data: publishResponse(noTerms.id), error: null });
    await publishBusinessEventDraft(noTerms);
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(["issue_1719_publish_event_with_poster"]);
  });
});

// ===========================================================================
// EP — the edit-published wizard
// ===========================================================================

const liveEvent = (overrides: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "event-3284",
  serverEventId: "server-event-3284",
  brandId: "brand-3284",
  brandSlug: "sunset",
  eventSlug: "rooftop-sessions",
  status: "scheduled",
  publishedAt: "2026-09-01T12:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  event_type: "event",
  name: "Rooftop Sessions",
  description: "Late sets on the roof.",
  format: "in_person",
  category: null,
  partyTypes: [PARTY_TYPE_SLUGS[0]],
  vibeTags: [],
  musicGenres: [],
  city: "London",
  locationGeo: { lat: 51.5, lng: -0.12 },
  whenMode: "single",
  date: "2030-06-01",
  doorsOpen: "20:00",
  endsAt: "23:30",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "The Roof",
  address: "1 High Street, London",
  onlineUrl: null,
  hideAddressUntilTicket: false,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: "GBP",
  tickets: [ticket()],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  themeOverrides: null,
  refundPolicy: EVENT_STANDARD_POLICY,
  orders: [],
  createdAt: "2026-09-01T11:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
  ...overrides,
});

describe("EP — event edit-published wizard", () => {
  test("EP-1 the by-id probe reads refund_policy onto the live event (null stays none)", async () => {
    const viewRow = {
      id: "event-3284",
      brand_id: "brand-3284",
      brand_slug: "sunset",
      title: "Rooftop Sessions",
      slug: "rooftop-sessions",
      status: "scheduled",
      visibility: "public",
      description: "Late sets.",
      timezone: "Europe/London",
      management_theme: { business_event: { settings: {} } },
      created_at: "2026-09-01T11:00:00.000Z",
      updated_at: "2026-09-01T12:00:00.000Z",
      published_at: "2026-09-01T12:00:00.000Z",
    };
    const setUp = (refund: unknown): void => {
      const eventsChain = {
        select: jest.fn(() => eventsChain),
        eq: () => eventsChain,
        maybeSingle: () =>
          Promise.resolve({
            data: { id: "event-3284", event_type: "event", refund_policy: refund },
            error: null,
          }),
      };
      const viewChain = {
        select: () => viewChain,
        eq: () => viewChain,
        maybeSingle: () => Promise.resolve({ data: viewRow, error: null }),
      };
      const ticketsChain = {
        select: () => ticketsChain,
        eq: () => ticketsChain,
        is: () => ticketsChain,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      mockFrom.mockImplementation((table) =>
        table === "events" ? eventsChain : table === "ticket_types" ? ticketsChain : viewChain,
      );
    };
    setUp(EVENT_STRICT_POLICY);
    expect((await fetchBusinessEventById("event-3284"))?.event.refundPolicy).toEqual(
      EVENT_STRICT_POLICY,
    );
    setUp(null);
    const none = await fetchBusinessEventById("event-3284");
    expect(none?.event.refundPolicy).toBeNull();
  });

  test("EP-2 the adapter maps, diffs and names the terms as a MATERIAL change", () => {
    const original = liveEvent();
    const seeded = liveEventToEditableDraft(original);
    expect(seeded.refundPolicy).toEqual(EVENT_STANDARD_POLICY);
    expect(editableDraftToPatch(original, seeded)).not.toHaveProperty("refundPolicy");
    // An unknown original seeds "no terms" without forging a diff.
    const unknown = liveEvent({ refundPolicy: undefined });
    expect(editableDraftToPatch(unknown, liveEventToEditableDraft(unknown))).toEqual({});

    const edited = { ...seeded, refundPolicy: NO_REFUNDS_POLICY };
    const patch = editableDraftToPatch(original, edited);
    expect(patch).toEqual({ refundPolicy: NO_REFUNDS_POLICY });
    expect(MATERIAL_KEYS).toContain("refundPolicy");
    expect(classifySeverity(["refundPolicy"])).toBe("material");
    const refundRows = (d: DraftEvent) =>
      computeRichFieldDiffs(original, d).filter((row) => row.fieldKey === "refundPolicy");
    expect(refundRows(seeded)).toEqual([]);
    expect(refundRows(edited)).toEqual([
      {
        fieldKey: "refundPolicy",
        fieldLabel: "Refund policy",
        oldValue: "Standard",
        newValue: "No refunds",
        severity: "material",
      },
    ]);
    expect(refundRows({ ...seeded, refundPolicy: null })[0].newValue).toBe("No policy");
    expect(
      refundRows({ ...seeded, refundPolicy: { kind: "custom", tiers: EVENT_STRICT_POLICY.tiers } })[0]
        .newValue,
    ).toBe("Custom (2 tiers)");
  });

  const REASON = "Tightening terms before launch";

  const openAndEdit = async (
    chipTestId: string,
    options: { alsoRequireApproval?: boolean } = {},
  ): Promise<Renderer> => {
    const tree = await mount(
      <EditPublishedScreen
        liveEvent={liveEvent()}
        disableLocalSaveReason="Server-loaded events are readable here."
      />,
    );
    const settingsHeader = host(tree, "Pressable").find(
      (n) => n.props.accessibilityLabel === "Settings section (collapsed)",
    );
    expect(settingsHeader).toBeDefined();
    await press(settingsHeader as TestInstance);
    // The sales banner shows on the published event (3 sold).
    expect(textOf(tree)).toContain("3 guests already bought under these terms.");
    await press(byTestId(tree, chipTestId));
    if (options.alsoRequireApproval === true) {
      const toggle = host(tree, "Pressable").find(
        (n) => n.props.accessibilityLabel === "Require approval to buy",
      );
      await press(toggle as TestInstance);
    }
    const save = host(tree, "ButtonProbe").find((n) => n.props.label === "Save changes");
    await press(save as TestInstance);
    const modal = host(tree, "ChangeSummaryModalProbe")[0];
    // A blocked save would show a toast instead of the reason sheet.
    expect(host(tree, "ToastProbe")[0].props.message).toBe("");
    expect(modal.props.visible).toBe(true);
    await act(async () => {
      await (modal.props.onConfirm as (reason: string) => Promise<void>)(REASON);
      await wait(500);
    });
    return tree;
  };

  const rpcNames = (): string[] => mockRpc.mock.calls.map((c) => c[0]);

  test("EP-3 a downgrade after sales opens 'Refund first' and sends NOTHING else", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? {
            data: { ok: false, reason: "refund_policy_downgrade_with_sales", affected_order_count: 3 },
            error: null,
          }
        : { data: { event: {} }, error: null },
    );
    const tree = await openAndEdit("refund-policy-chip-strict", { alsoRequireApproval: true });
    expect(rpcNames()).toEqual(["business_patch_offering_refund_policy"]);
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_event_id: "server-event-3284",
      p_policy: EVENT_STRICT_POLICY,
      p_reason: REASON,
    });
    const dialog = host(tree, "ConfirmDialogProbe")[0];
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.title).toBe("Refund first");
    expect(dialog.props.description).toBe(
      "3 buyers bought under the current refund terms. You can make refunds more generous, but to lower them, refund existing buyers first.",
    );
    expect(dialog.props.confirmLabel).toBe("Open Orders");
    await act(async () => {
      tree.unmount();
    });
  });

  test("EP-4 an unavailable owner shows the toast and sends nothing else", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
        : { data: { event: {} }, error: null },
    );
    const tree = await openAndEdit("refund-policy-chip-flexible", { alsoRequireApproval: true });
    expect(rpcNames()).toEqual(["business_patch_offering_refund_policy"]);
    const toast = host(tree, "ToastProbe")[0];
    expect(toast.props.visible).toBe(true);
    expect(toast.props.message).toBe(REFUND_TERMS_UNAVAILABLE_COPY);
    await act(async () => {
      tree.unmount();
    });
  });

  test("EP-5 on success the terms go FIRST and the key never reaches the atomic live-event write", async () => {
    mockRpc.mockImplementation(async (name) =>
      name === "business_patch_offering_refund_policy"
        ? { data: { ok: true, refundPolicy: EVENT_FLEXIBLE_POLICY, changed: true }, error: null }
        : { data: { event: { id: "server-event-3284" } }, error: null },
    );
    const tree = await openAndEdit("refund-policy-chip-flexible", { alsoRequireApproval: true });
    expect(rpcNames()).toEqual([
      "business_patch_offering_refund_policy",
      "business_update_live_event_atomic",
    ]);
    const atomicArgs = mockRpc.mock.calls[1][1] as { p_patch: { core: Record<string, unknown> } };
    expect(atomicArgs.p_patch.core).toEqual({ requireApproval: true });
    expect(JSON.stringify(atomicArgs.p_patch)).not.toContain("refundPolicy");
    expect(host(tree, "ToastProbe")[0].props.message).toBe("Saved. Live now.");
    await act(async () => {
      tree.unmount();
    });
  });

  test("EP-6 a refund-only change saves through the owner alone", async () => {
    mockRpc.mockImplementation(async () => ({
      data: { ok: true, refundPolicy: EVENT_FLEXIBLE_POLICY, changed: true },
      error: null,
    }));
    const tree = await openAndEdit("refund-policy-chip-flexible");
    expect(rpcNames()).toEqual(["business_patch_offering_refund_policy"]);
    expect(host(tree, "ToastProbe")[0].props.message).toBe("Saved. Live now.");
    await act(async () => {
      tree.unmount();
    });
  });
});
