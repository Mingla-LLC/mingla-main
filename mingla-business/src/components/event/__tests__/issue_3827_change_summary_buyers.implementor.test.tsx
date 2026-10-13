/* eslint-disable import/first */
// issue #3827 [live event editor: one owner for location, buyer-aware reason]
// — implementor happy-path regression for Review changes and the buyer count.
//
// WHAT THIS FILE PINS
//   CS-*   the REAL ChangeSummaryModal, rendered. With `buyerCount` absent,
//          null or 1+ nothing changes: the NOTIFIES BUYERS tag, the email/SMS
//          footer, the required reason, Save disabled until 10 characters.
//          With a KNOWN zero: no tag, the edit-history footer instead, the
//          label "Reason (optional)", and Save enabled when the reason is
//          blank or 10..200 characters (and still disabled for 1..9).
//   BC-*   the REAL useEventBuyerCount, rendered under a real QueryClient:
//          the server's number when it answers; null while loading, on an
//          error, when the function is missing, on a malformed answer, and
//          with no server id or before the session is ready (no request at all).
//   WIRE-* the editor wiring, read from source: the event route reads the
//          count and hands it down; RSVP passes `undefined`; the guard is told
//          the reason is optional only for a known zero; a save that includes
//          visibility or refund terms keeps the reason mandatory.
//
// FAILS-ON-REVERT: restore ChangeSummaryModal.tsx from origin/main and every
// CS zero-buyer test goes red; delete useEventBuyerCount.ts and BC-* cannot
// load; restore EditPublishedScreen.tsx or app/event/[id]/edit.tsx and WIRE-*
// goes red.

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// module boundaries (network + chrome leaves only; product logic stays real)
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { message: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  },
}));
const mockAuth = { isAuthReady: true };
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    props.visible ? require("react").createElement("SheetProbe", null, props.children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("IconProbe", props),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: (props: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ScrollViewProbe", null, props.children),
}));

import { ChangeSummaryModal } from "../ChangeSummaryModal";
import type { ChangeSummaryModalProps } from "../ChangeSummaryModal";
import { useEventBuyerCount } from "../../../hooks/useEventBuyerCount";
import type { FieldDiff } from "../../../utils/liveEventAdapter";

const MATERIAL_DIFF: FieldDiff = {
  fieldKey: "address",
  fieldLabel: "Address",
  oldValue: "61 Wythe Avenue, Brooklyn",
  newValue: "250 Bedford Avenue, Brooklyn",
  severity: "material",
};
const ADDITIVE_DIFF: FieldDiff = {
  fieldKey: "description",
  fieldLabel: "Description",
  oldValue: "Doors at eight.",
  newValue: "Doors at half past seven.",
  severity: "safe",
};

const NOTIFY_TAG = "NOTIFIES BUYERS";
const EMAIL_FOOTER =
  "Material changes notify your buyers by email. Your reason will be included in the message.";
const SMS_FOOTER =
  "Material changes notify your buyers by email and SMS. Your reason will be included in the message.";
const LOG_FOOTER =
  "Changes will be logged in your event's edit history. No buyer notification.";
const REQUIRED_LABEL = "Why are you making this change? *";
const OPTIONAL_LABEL = "Reason (optional)";

const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

/** Every rendered Text node's full string. */
const texts = (tree: Renderer): string[] =>
  tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => textOf(node));

const saveButton = (tree: Renderer): TestInstance => {
  const found = tree.root.findAll(
    (node) =>
      (node.type as unknown) === "ButtonProbe" && node.props.label === "Save changes",
  );
  expect(found).toHaveLength(1);
  return found[0];
};

const reasonInput = (tree: Renderer): TestInstance => {
  const found = tree.root.findAll(
    (node) => node.props.accessibilityLabel === "Reason for change" &&
      typeof node.props.onChangeText === "function",
  );
  expect(found.length).toBeGreaterThanOrEqual(1);
  return found[0];
};

const typeReason = async (tree: Renderer, value: string): Promise<void> => {
  await act(async () => {
    (reasonInput(tree).props.onChangeText as (text: string) => void)(value);
  });
};

const mountModal = async (
  props: Partial<ChangeSummaryModalProps> = {},
): Promise<{ tree: Renderer; onConfirm: jest.Mock<(reason: string) => void> }> => {
  const onConfirm = jest.fn<(reason: string) => void>();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ChangeSummaryModal
        visible
        diffs={[MATERIAL_DIFF, ADDITIVE_DIFF]}
        severity="material"
        webPurchasePresent={false}
        onClose={() => undefined}
        onConfirm={onConfirm}
        {...props}
      />,
    );
  });
  return { tree, onConfirm };
};

describe("issue #3827 — Review changes with buyers, or without knowing", () => {
  test.each([
    ["omitted (trip editors, RSVP)", {}],
    ["null (unknown)", { buyerCount: null }],
    ["one buyer", { buyerCount: 1 }],
    ["many buyers", { buyerCount: 250 }],
  ] as Array<[string, Partial<ChangeSummaryModalProps>]>)(
    "CS-1: buyerCount %s leaves the sheet exactly as it was",
    async (_label, props) => {
      const { tree, onConfirm } = await mountModal(props);
      const all = texts(tree);
      expect(all.filter((t) => t === NOTIFY_TAG)).toHaveLength(1);
      expect(all).toContain(EMAIL_FOOTER);
      expect(all).not.toContain(LOG_FOOTER);
      expect(all).toContain(REQUIRED_LABEL);
      expect(all).not.toContain(OPTIONAL_LABEL);
      expect(all).toContain("Min 10 characters");

      // Blank: Save is disabled and pressing it sends nothing.
      expect(saveButton(tree).props.disabled).toBe(true);
      await act(async () => {
        (saveButton(tree).props.onPress as () => void)();
      });
      expect(onConfirm).not.toHaveBeenCalled();

      await typeReason(tree, "too short");
      expect(saveButton(tree).props.disabled).toBe(true);

      await typeReason(tree, "  Moving to the bigger room  ");
      expect(saveButton(tree).props.disabled).toBe(false);
      await act(async () => {
        (saveButton(tree).props.onPress as () => void)();
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith("Moving to the bigger room");
      tree.unmount();
    },
  );

  test("CS-2: with buyers and a web purchase the SMS copy is untouched", async () => {
    const { tree } = await mountModal({ buyerCount: 4, webPurchasePresent: true });
    expect(texts(tree)).toContain(SMS_FOOTER);
    tree.unmount();
  });
});

describe("issue #3827 — Review changes for an event nobody has bought", () => {
  test("CS-3: no NOTIFIES BUYERS tag and no email/SMS promise; the edit-history line instead", async () => {
    for (const webPurchasePresent of [false, true]) {
      const { tree } = await mountModal({ buyerCount: 0, webPurchasePresent });
      const all = texts(tree);
      expect(all).not.toContain(NOTIFY_TAG);
      expect(all).not.toContain(EMAIL_FOOTER);
      expect(all).not.toContain(SMS_FOOTER);
      expect(all).toContain(LOG_FOOTER);
      // The change rows themselves are still listed.
      expect(all).toContain("Address");
      expect(all).toContain("250 Bedford Avenue, Brooklyn");
      tree.unmount();
    }
  });

  test("CS-4: the reason is labelled optional and Save is enabled with it blank", async () => {
    const { tree, onConfirm } = await mountModal({ buyerCount: 0 });
    const all = texts(tree);
    expect(all).toContain(OPTIONAL_LABEL);
    expect(all).not.toContain(REQUIRED_LABEL);
    expect(all).not.toContain("Min 10 characters");

    expect(saveButton(tree).props.disabled).toBe(false);
    await act(async () => {
      (saveButton(tree).props.onPress as () => void)();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("");
    tree.unmount();
  });

  test("CS-5: a reason the host does type is still held to 10..200 characters", async () => {
    const { tree, onConfirm } = await mountModal({ buyerCount: 0 });

    await typeReason(tree, "typo");
    expect(saveButton(tree).props.disabled).toBe(true);
    await act(async () => {
      (saveButton(tree).props.onPress as () => void)();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // Whitespace only is blank, so it is allowed.
    await typeReason(tree, "     ");
    expect(saveButton(tree).props.disabled).toBe(false);

    await typeReason(tree, "Fixing the address");
    expect(saveButton(tree).props.disabled).toBe(false);
    await act(async () => {
      (saveButton(tree).props.onPress as () => void)();
    });
    expect(onConfirm).toHaveBeenCalledWith("Fixing the address");
    tree.unmount();
  });

  test("CS-6: with nothing to save, Save stays disabled even when the reason is optional", async () => {
    const { tree } = await mountModal({ buyerCount: 0, diffs: [] });
    expect(saveButton(tree).props.disabled).toBe(true);
    tree.unmount();
  });

  test("CS-7: an additive-only change reads the same with or without buyers", async () => {
    for (const buyerCount of [0, 3]) {
      const { tree } = await mountModal({
        buyerCount,
        diffs: [ADDITIVE_DIFF],
        severity: "additive",
      });
      const all = texts(tree);
      expect(all).toContain(LOG_FOOTER);
      expect(all).not.toContain(NOTIFY_TAG);
      tree.unmount();
    }
  });
});

// ── useEventBuyerCount ──────────────────────────────────────────────────────

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
};

const mountCount = async (
  serverEventId: string | null,
): Promise<{ read: () => number | null | undefined; tree: Renderer; client: QueryClient }> => {
  let latest: number | null | undefined;
  const Probe = (): null => {
    latest = useEventBuyerCount(serverEventId);
    return null;
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { read: () => latest, tree, client };
};

describe("issue #3827 — useEventBuyerCount", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockAuth.isAuthReady = true;
  });

  test("BC-1: it asks the server's one definition of a buyer and returns its number", async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });
    const zero = await mountCount("server-event-3827");
    // Not known until the server answers.
    expect(zero.read()).toBeNull();
    await flush();
    expect(zero.read()).toBe(0);
    expect(mockRpc).toHaveBeenCalledWith("business_event_buyer_count", {
      p_event_id: "server-event-3827",
    });
    zero.tree.unmount();
    zero.client.clear();

    mockRpc.mockResolvedValue({ data: 7, error: null });
    const seven = await mountCount("server-event-3827-b");
    await flush();
    expect(seven.read()).toBe(7);
    seven.tree.unmount();
    seven.client.clear();
  });

  test("BC-2: a failed request is 'not known', never zero", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "insufficient_event_permission" } });
    const failed = await mountCount("server-event-3827");
    await flush();
    expect(failed.read()).toBeNull();
    failed.tree.unmount();
    failed.client.clear();
  });

  test("BC-3: a server without the function yet is 'not known' (web ships before the migration)", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.business_event_buyer_count(p_event_id) in the schema cache",
      },
    });
    const missing = await mountCount("server-event-3827");
    await flush();
    expect(missing.read()).toBeNull();
    missing.tree.unmount();
    missing.client.clear();
  });

  test("BC-4: an answer that is not a count is 'not known'", async () => {
    for (const data of [null, "0", -1, Number.NaN, { count: 0 }]) {
      mockRpc.mockResolvedValue({ data, error: null });
      const odd = await mountCount(`server-event-3827-${String(data)}`);
      await flush();
      expect(odd.read()).toBeNull();
      odd.tree.unmount();
      odd.client.clear();
    }
  });

  test("BC-6: before the session is ready it makes no request and is 'not known'", async () => {
    mockAuth.isAuthReady = false;
    mockRpc.mockResolvedValue({ data: 0, error: null });
    const early = await mountCount("server-event-3827");
    await flush();
    expect(early.read()).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    early.tree.unmount();
    early.client.clear();
  });

  test("BC-5: with no server id it makes no request and is 'not known'", async () => {
    const none = await mountCount(null);
    await flush();
    expect(none.read()).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    none.tree.unmount();
    none.client.clear();
  });
});

// ── wiring ──────────────────────────────────────────────────────────────────

const read = (relative: string): string =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const squash = (source: string): string => source.replace(/\s+/g, " ");

describe("issue #3827 — the editor is wired to the buyer count", () => {
  const screen = squash(read("../EditPublishedScreen.tsx"));
  const eventRoute = squash(read("../../../../app/event/[id]/edit.tsx"));
  const rsvpRoute = squash(read("../../../../app/rsvp/[id]/edit.tsx"));

  test("WIRE-1: the event route reads the count and hands it to the editor", () => {
    expect(eventRoute).toContain(
      "const buyerCount = useEventBuyerCount(props.liveEvent.serverEventId);",
    );
    expect(eventRoute).toContain(
      "<EditPublishedScreen {...props} buyerCount={buyerCount} />",
    );
    expect(eventRoute).toContain("<EditPublishedEventWithBuyerCount");
    // The published-event editor is mounted through that wrapper only.
    expect(eventRoute.match(/<EditPublishedScreen\b/g)).toHaveLength(1);
  });

  test("WIRE-2: the RSVP route does not pass a count, and the editor never relaxes RSVP", () => {
    expect(rsvpRoute).not.toContain("buyerCount");
    expect(rsvpRoute).not.toContain("useEventBuyerCount");
    expect(screen).toContain("buyerCount = null,");
    expect(screen).toContain(
      "const reasonOptional = !rsvpMode && buyerCount === 0 && currentPatch.visibility === undefined && currentPatch.refundPolicy === undefined;",
    );
    expect(screen).toContain(
      "buyerCount={ rsvpMode ? undefined : reasonOptional ? 0 : buyerCount === 0 ? null : buyerCount }",
    );
  });

  test("WIRE-3: the guard is told the reason is optional only when it is", () => {
    expect(screen).toMatch(
      /validateLiveEventFieldUpdate\( liveEvent, patch, soldCountCtx, reason, (\/\/[^\n]*?)?.*?!reasonOptional, \)/,
    );
    // The RSVP save path is untouched: it still sends the typed reason as is.
    expect(screen).toContain(
      "buildRsvpUpdatePayloadDiff(liveEvent, editState), reason, );",
    );
  });

  test("WIRE-4: a blank reason is logged locally in the server's words, after the server save", () => {
    expect(screen).toContain(
      "validation.trimmedReason.length > 0 ? validation.trimmedReason : NO_BUYERS_EDIT_REASON,",
    );
    // The server itself is handed what the host typed (blank included).
    expect(screen).toContain(
      "await patchPublishedEventAtomically( liveEvent.serverEventId, atomicPatch, validation.trimmedReason,",
    );
  });

  test("WIRE-5: a re-picked pin carries its precision; an untouched pin sends none", () => {
    expect(screen).toContain(
      "...(patch.locationGeo !== undefined ? { coordinatePrecision: patch.locationGeo === null ? null : (editState.coordinatePrecision ?? null), } : {}),",
    );
  });
});
