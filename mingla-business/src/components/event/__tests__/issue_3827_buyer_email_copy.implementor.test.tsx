/* eslint-disable import/first */
// issue #3827 [buyer email on a live-listing change] — implementor happy-path
// regression for every word a host reads about emailing buyers after a live
// edit.
//
// WHAT THIS FILE PINS
//   FT-*   the REAL ChangeSummaryModal, rendered, in its four footer states:
//          emails on with buyers ("We'll email your 254 buyers what changed
//          and your reason."), emails not on ("Buyer emails are not switched
//          on yet. …"), nothing a buyer is emailed about (the edit-history
//          line), and a trip ("Logged in your trip's edit history. …").
//   TAG-*  the NOTIFIES BUYERS tag sits only on rows the server emails about,
//          and only when the footer says buyers will be told.
//   TS-*   the toast after a save comes from the server's `buyer_notice`.
//   BN-*   both banners, rendered: no text-message or push promise, and the
//          "Last update" line with a failure shown as an alert.
//   ST-*   the REAL useEventBuyerNoticeStatus under a real QueryClient: the
//          server's answer when it comes; null while loading, on an error,
//          when the function is missing, on a malformed answer, with no
//          server id and before the session is ready (no request at all).
//   WIRE-* the editors are wired to the server's answer, read from source.
//
// FAILS-ON-REVERT: restore ChangeSummaryModal.tsx from origin/main and FT-1,
// FT-2, FT-4, TAG-* and NO-SMS go red; restore either banner and BN-1/BN-2 go
// red; delete utils/buyerNoticeCopy.ts or hooks/useEventBuyerNoticeStatus.ts
// and the file cannot load; restore EditPublishedScreen.tsx and WIRE-* go red.

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

// module boundaries (network + chrome leaves only; product logic stays real)
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
import { EditAfterPublishBanner } from "../EditAfterPublishBanner";
import { EditAfterPublishTripBanner } from "../../trip/EditAfterPublishTripBanner";
import { EditAfterPublishExperienceBanner } from "../../experience/EditAfterPublishExperienceBanner";
import {
  eventBuyerNoticeStatusKeys,
  useEventBuyerNoticeStatus,
} from "../../../hooks/useEventBuyerNoticeStatus";
import {
  buyerNoticeSavedToast,
  changeSummaryNotice,
  experienceLiveEditNotice,
  lastNoticeLine,
  parseBuyerNoticeStatus,
  rsvpSavedToast,
  type BuyerNoticeStatus,
} from "../../../utils/buyerNoticeCopy";
import type { FieldDiff } from "../../../utils/liveEventAdapter";

const diff = (fieldKey: string, severity: FieldDiff["severity"]): FieldDiff =>
  ({
    fieldKey,
    fieldLabel: `Label ${fieldKey}`,
    oldValue: `old ${fieldKey}`,
    newValue: `new ${fieldKey}`,
    severity,
  }) as FieldDiff;

const ADDRESS = diff("address", "material");
const DATE = diff("date", "material");
const TICKETS = diff("tickets", "material");
const REFUND = diff("refundPolicy", "material");
const DESCRIPTION = diff("description", "safe");

const LIVE_254: BuyerNoticeStatus = { live: true, audience: 254, last: null };
const OFF: BuyerNoticeStatus = { live: false, audience: 254, last: null };

const WILL_EMAIL = "We'll email your 254 buyers what changed and your reason.";
const NOT_ON =
  "Buyer emails are not switched on yet. This change is saved and logged; buyers are not emailed.";
const LOGGED =
  "Changes will be logged in your event's edit history. No buyer notification.";
const TRIP_LOGGED =
  "Logged in your trip's edit history. Travellers are not emailed about edits yet.";
const TAG = "NOTIFIES BUYERS";

const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const texts = (tree: Renderer): string[] =>
  tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => textOf(node));

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

const mountModal = (props: Partial<ChangeSummaryModalProps> = {}): Promise<Renderer> =>
  mount(
    <ChangeSummaryModal
      visible
      diffs={[ADDRESS, DESCRIPTION]}
      severity="material"
      onClose={() => undefined}
      onConfirm={() => undefined}
      buyerCount={3}
      {...props}
    />,
  );

/** The field labels of the rows that carry the tag. */
const taggedRows = (tree: Renderer, tag: string = TAG): string[] => {
  const all = texts(tree);
  return all.flatMap((text, index) => (text === tag ? [all[index - 1]] : []));
};

describe("issue #3827 — the four footer states of Review changes", () => {
  test("FT-1: emails on, with buyers: the count, and what will be sent", async () => {
    const tree = await mountModal({ buyerNoticeStatus: LIVE_254 });
    const all = texts(tree);
    expect(all).toContain(WILL_EMAIL);
    expect(all).not.toContain(NOT_ON);
    expect(all).not.toContain(LOGGED);
    tree.unmount();

    const one = await mountModal({ buyerNoticeStatus: { live: true, audience: 1, last: null } });
    expect(texts(one)).toContain("We'll email your 1 buyer what changed and your reason.");
    one.unmount();
  });

  test("FT-2: emails not on (off, unknown, or a caller that never asked): said plainly", async () => {
    for (const buyerNoticeStatus of [OFF, null, undefined]) {
      const tree = await mountModal({ buyerNoticeStatus });
      const all = texts(tree);
      expect(all).toContain(NOT_ON);
      expect(all).not.toContain(WILL_EMAIL);
      expect(all.join(" ")).not.toMatch(/We'll email/);
      tree.unmount();
    }
  });

  test("FT-3: nothing a buyer is emailed about: the edit-history line, whatever the switch says", async () => {
    const cases: Array<Partial<ChangeSummaryModalProps>> = [
      // An additive-only change.
      { diffs: [DESCRIPTION], severity: "additive", buyerNoticeStatus: LIVE_254 },
      // Material to the editor, but tickets and refund terms are not emailed.
      { diffs: [TICKETS, REFUND], severity: "material", buyerNoticeStatus: LIVE_254 },
      // Nobody has bought.
      { buyerCount: 0, buyerNoticeStatus: LIVE_254 },
      // Emails on, and the server counts nobody to tell.
      { buyerNoticeStatus: { live: true, audience: 0, last: null } },
    ];
    for (const props of cases) {
      const tree = await mountModal(props);
      const all = texts(tree);
      expect(all).toContain(LOGGED);
      expect(all).not.toContain(WILL_EMAIL);
      expect(all).not.toContain(NOT_ON);
      expect(all).not.toContain(TAG);
      tree.unmount();
    }
  });

  test("FT-4: a trip: logged, and travellers are not emailed yet", async () => {
    for (const severity of ["material", "additive"] as const) {
      const tree = await mountModal({
        entityLabel: "trip",
        severity,
        diffs: [diff("start_date", "material"), DESCRIPTION],
        buyerCount: undefined,
        buyerNoticeStatus: LIVE_254,
      });
      const all = texts(tree);
      expect(all).toContain(TRIP_LOGGED);
      expect(all).not.toContain(TAG);
      expect(all.join(" ")).not.toMatch(/We'll email|notify your/i);
      tree.unmount();
    }
  });

  test("FT-5: an RSVP speaks of guests, and before emails are on says what guests get today", async () => {
    const on = await mountModal({
      buyerCount: undefined,
      buyerNoticeNoun: "guests",
      buyerNoticeStatus: { live: true, audience: 12, last: null },
    });
    expect(texts(on)).toContain("We'll email your 12 guests what changed and your reason.");
    expect(taggedRows(on, "NOTIFIES GUESTS")).toEqual(["Label address"]);
    on.unmount();

    const off = await mountModal({
      buyerCount: undefined,
      buyerNoticeNoun: "guests",
      buyerNoticeStatus: null,
    });
    const all = texts(off);
    expect(all).toContain(
      "Going guests are alerted that plans changed. Your reason is logged; it is not sent to them yet.",
    );
    expect(all.join(" ")).not.toMatch(/We'll email/);
    off.unmount();
  });

  test("NO-SMS: no state of the sheet mentions a text message or a push alert", async () => {
    const states: Array<Partial<ChangeSummaryModalProps>> = [
      { buyerNoticeStatus: LIVE_254 },
      { buyerNoticeStatus: OFF },
      { buyerNoticeStatus: null },
      { buyerNoticeStatus: LIVE_254, webPurchasePresent: true },
      { buyerNoticeStatus: undefined, webPurchasePresent: true },
      { buyerCount: 0 },
      { entityLabel: "trip", buyerCount: undefined, webPurchasePresent: true },
      { buyerCount: undefined, buyerNoticeNoun: "guests", buyerNoticeStatus: null },
      { diffs: [DESCRIPTION], severity: "additive" },
    ];
    for (const props of states) {
      const tree = await mountModal(props);
      expect(texts(tree).join(" | ")).not.toMatch(/\bSMS\b|text message|\btexted\b|\bpush\b/i);
      tree.unmount();
    }
  });
});

describe("issue #3827 rework — testing, people without an address, refused dates", () => {
  test("FT-6 (F2): while emails are being tested the host is not told buyers will be emailed", async () => {
    const testing: BuyerNoticeStatus = { live: true, audience: 254, allowlistOnly: true, last: null };
    const tree = await mountModal({ buyerNoticeStatus: testing });
    const all = texts(tree);
    expect(all).toContain(
      "Buyer emails are being tested. Only test addresses will be emailed about this change; your buyers are not emailed yet.",
    );
    expect(all.join(" ")).not.toMatch(/We'll email/);
    expect(taggedRows(tree)).toEqual([]);
    tree.unmount();

    const guests = await mountModal({
      buyerCount: undefined, buyerNoticeNoun: "guests", buyerNoticeStatus: testing,
    });
    expect(texts(guests)).toContain(
      "Guest emails are being tested. Only test addresses get the new email; your other going guests get the usual alert that plans changed.",
    );
    guests.unmount();

    expect(experienceLiveEditNotice(testing)).toMatch(/^Buyer emails are being tested\./);
    const scheduled = {
      state: "scheduled", live: true, material: true, audience: 254, allowlist_only: true,
      send_after: new Date(Date.now() + 5 * 60000).toISOString(),
    };
    expect(buyerNoticeSavedToast(scheduled)).toBe(
      "Saved. Buyer emails are being tested, so only test addresses will be emailed about this change.",
    );
    expect(buyerNoticeSavedToast(scheduled, "guests")).toBe(
      "Saved. Guest emails are being tested: only test addresses get the new email, and your other going guests get the usual alert.",
    );
  });

  test("FT-7 (F3): the count is the people an email reaches, and those with none are named", async () => {
    const status = parseBuyerNoticeStatus({ live: true, audience: 3, noEmail: 2, allowlistOnly: false, last: null });
    expect(status).toEqual({ live: true, audience: 3, noEmail: 2, last: null });
    const tree = await mountModal({ buyerNoticeStatus: status });
    expect(texts(tree)).toContain(
      "We'll email your 3 buyers what changed and your reason. 2 have no email address.",
    );
    tree.unmount();
    const one = await mountModal({ buyerNoticeStatus: { live: true, audience: 3, noEmail: 1, last: null } });
    expect(texts(one)).toContain("We'll email your 3 buyers what changed and your reason. 1 has no email address.");
    one.unmount();
    // Bought, but nobody can be emailed: nothing is promised.
    const nobody = await mountModal({ buyerNoticeStatus: { live: true, audience: 0, noEmail: 4, last: null } });
    expect(texts(nobody)).toContain(LOGGED);
    nobody.unmount();
    expect(experienceLiveEditNotice({ live: true, audience: 0, noEmail: 4, last: null })).toBe(
      "None of your buyers has an email address, so nobody is emailed. Your reason is saved and logged.",
    );
  });

  test("FT-8: with tickets sold, a date or time row is never tagged as emailed", async () => {
    const tree = await mountModal({
      diffs: [ADDRESS, DATE, diff("doorsOpen", "material")],
      buyerNoticeStatus: LIVE_254,
      whenChangeRefused: true,
    });
    expect(taggedRows(tree)).toEqual(["Label address"]);
    tree.unmount();
    const onlyWhen = await mountModal({ diffs: [DATE], buyerNoticeStatus: LIVE_254, whenChangeRefused: true });
    expect(taggedRows(onlyWhen)).toEqual([]);
    expect(texts(onlyWhen).join(" ")).not.toMatch(/We'll email/);
    onlyWhen.unmount();
  });

  test("TS-3: an RSVP save the email owns but did not schedule says only that it saved", () => {
    expect(rsvpSavedToast({ state: "logged", live: true, material: true, audience: 12 })).toBe("Saved. Live now.");
    // Not owned by the email (off, or nothing a guest acts on): the caller decides.
    expect(rsvpSavedToast({ state: "held", hold_code: "feature_off", live: false, material: true, audience: 12 })).toBeNull();
    expect(rsvpSavedToast({ state: "logged", live: true, material: false, audience: 12 })).toBeNull();
    expect(rsvpSavedToast(undefined)).toBeNull();
    // While emails are being tested off-list guests DID get the usual alert.
    expect(rsvpSavedToast({ state: "logged", live: true, material: true, allowlist_only: true, audience: 2 })).toBeNull();
  });

  test("BN-4: the last-update line says guests for an RSVP", () => {
    const status: BuyerNoticeStatus = {
      live: true, audience: 12,
      last: { state: "fanned_out", holdCode: null, audience: 12, sent: 11, pending: 0, failed: 0, noEmail: 1, held: 0 },
    };
    expect(lastNoticeLine(status, "guests")?.text).toBe(
      "Last update: sent to 11 of 12 guests · 1 has no email address · 0 failed",
    );
    expect(lastNoticeLine({ ...status, last: { ...status.last!, state: "scheduled" } }, "guests")?.text).toBe(
      "Last update: an email to 12 guests is waiting to go out.",
    );
  });
});

describe("issue #3827 rework D3 — the last-update line in every state", () => {
  const base = { holdCode: null, audience: 260, sent: 0, pending: 0, failed: 0, noEmail: 6, held: 0 };
  test("LU-1: waiting while emails are being tested names the test addresses, not the buyers", () => {
    expect(lastNoticeLine({ live: true, audience: 254, last: {
      ...base, state: "scheduled", emailable: 254, testing: true, testAddresses: 3,
    } })?.text).toBe(
      "Last update: waiting to go out to 3 test addresses. Your buyers are not emailed while emails are being tested.",
    );
    // Not testing: the people it can reach, not those without an address.
    expect(lastNoticeLine({ live: true, audience: 254, last: {
      ...base, state: "scheduled", emailable: 254, testing: false, testAddresses: 0,
    } })?.text).toBe("Last update: an email to 254 buyers is waiting to go out.");
  });

  test("LU-2: copies stopped because emails were switched off say so", () => {
    expect(lastNoticeLine({ live: false, audience: 254, last: {
      ...base, state: "fanned_out", audience: 260, held: 254, heldSwitchedOff: 254, heldTesting: 0, alerted: 0,
    } })?.text).toBe(
      "Last update: not sent, because buyer emails were switched off. 254 buyers were not emailed.",
    );
    expect(lastNoticeLine({ live: true, audience: 254, last: {
      ...base, state: "fanned_out", audience: 260, sent: 200, held: 54, heldSwitchedOff: 54, heldTesting: 0, alerted: 0,
    } })?.text).toBe(
      "Last update: sent to 200 of 260 · 6 have no email address · 54 not sent because emails were switched off · 0 failed",
    );
  });

  test("LU-3: an RSVP under test counts guests alerted the usual way once, not as held", () => {
    expect(lastNoticeLine({ live: true, audience: 3, last: {
      ...base, state: "fanned_out", audience: 3, noEmail: 0, sent: 1, held: 0, heldTesting: 0, heldSwitchedOff: 0, alerted: 2,
    } }, "guests")?.text).toBe("Last update: 2 guests alerted the usual way · 1 test address emailed");
    const parsed = parseBuyerNoticeStatus({ live: true, audience: 3, last: {
      state: "fanned_out", holdCode: null, audience: 3, sent: 1, pending: 0, failed: 0, noEmail: 0,
      held: 0, heldTesting: 0, heldSwitchedOff: 0, alerted: 2, emailable: 2, testing: true, testAddresses: 1,
    } });
    expect(parsed?.last?.alerted).toBe(2);
    expect(parsed?.last?.testing).toBe(true);
  });
});

describe("issue #3827 — the NOTIFIES BUYERS tag", () => {
  test("TAG-1: only on rows the server emails about, and only when buyers will be told", async () => {
    const diffs = [ADDRESS, DATE, TICKETS, REFUND, DESCRIPTION];
    const on = await mountModal({ diffs, buyerNoticeStatus: LIVE_254 });
    expect(taggedRows(on)).toEqual(["Label address", "Label date"]);
    on.unmount();

    for (const buyerNoticeStatus of [OFF, null]) {
      const off = await mountModal({ diffs, buyerNoticeStatus });
      expect(taggedRows(off)).toEqual([]);
      off.unmount();
    }
  });

  test("TAG-2: every field the server emails about is one the editor can change", () => {
    const tagged = changeSummaryNotice({
      loggedCopy: LOGGED,
      entityLabel: "event",
      severity: "material",
      noBuyers: false,
      fieldKeys: [
        "format", "date", "doorsOpen", "endsAt", "timezone", "venueName", "address",
        "onlineUrl", "whenMode", "recurrenceRule", "multiDates",
        "tickets", "refundPolicy", "name", "description", "coverHue", "visibility",
      ],
      status: LIVE_254,
      noun: "buyers",
    }).taggedKeys;
    expect([...tagged].sort()).toEqual([
      "address", "date", "doorsOpen", "endsAt", "format", "multiDates", "onlineUrl",
      "recurrenceRule", "timezone", "venueName", "whenMode",
    ]);
  });
});

describe("issue #3827 — the toast after a save is the server's answer", () => {
  const NOW = Date.parse("2026-11-06T12:00:00Z");
  const scheduled = (audience: number, minutes: number): Record<string, unknown> => ({
    state: "scheduled",
    hold_code: null,
    live: true,
    material: true,
    audience,
    send_after: new Date(NOW + minutes * 60000).toISOString(),
  });

  test("TS-1: a scheduled email names the count and the wait", () => {
    expect(buyerNoticeSavedToast(scheduled(254, 5), "buyers", NOW)).toBe(
      "Saved. We'll email 254 buyers in about 5 minutes.",
    );
    expect(buyerNoticeSavedToast(scheduled(1, 5), "buyers", NOW)).toBe(
      "Saved. We'll email 1 buyer in about 5 minutes.",
    );
    expect(buyerNoticeSavedToast(scheduled(12, 16), "guests", NOW)).toBe(
      "Saved. We'll email 12 guests in about 16 minutes.",
    );
    expect(buyerNoticeSavedToast(scheduled(3, 1), "buyers", NOW)).toBe(
      "Saved. We'll email 3 buyers in about 1 minute.",
    );
  });

  test("TS-2: anything the server did not schedule promises nothing", () => {
    const silent: unknown[] = [
      undefined,
      null,
      "scheduled",
      {},
      { state: "logged", audience: 254, live: true },
      { state: "held", hold_code: "feature_off", audience: 254, live: false },
      { state: "held", hold_code: "refund_all", audience: 254, live: true },
      { state: "held", hold_code: "recorder_error", audience: 0, live: false },
      { state: "scheduled", audience: 0, live: true },
      { state: "sent", audience: 254, live: true },
    ];
    for (const raw of silent) {
      expect(buyerNoticeSavedToast(raw, "buyers", NOW)).toBeNull();
    }
  });
});

describe("issue #3827 — the live-edit banners", () => {
  test("BN-1: neither banner promises an email, a text message or a push alert", async () => {
    for (const element of [<EditAfterPublishBanner key="e" />, <EditAfterPublishTripBanner key="t" />]) {
      const tree = await mount(element);
      const all = texts(tree).join(" | ");
      expect(all).not.toMatch(/\bSMS\b|text message|\bpush\b/i);
      expect(all).not.toMatch(/notify your/i);
      tree.unmount();
    }
    const trip = await mount(<EditAfterPublishTripBanner />);
    expect(texts(trip).join(" ")).toMatch(/travelers are not emailed about edits yet/);
    trip.unmount();
  });

  test("BN-2: the last update line, and a failure shown as an alert", async () => {
    const status = parseBuyerNoticeStatus({
      live: true,
      audience: 254,
      last: {
        state: "fanned_out", holdCode: null, audience: 254,
        sent: 249, pending: 0, failed: 0, noEmail: 5, held: 0,
      },
    });
    const line = lastNoticeLine(status);
    expect(line).toEqual({
      text: "Last update: sent to 249 of 254 · 5 have no email address · 0 failed",
      failed: false,
    });
    const tree = await mount(<EditAfterPublishBanner lastNotice={line} />);
    expect(texts(tree)).toContain(
      "Last update: sent to 249 of 254 · 5 have no email address · 0 failed",
    );
    expect(tree.root.findAll((node) => node.props.accessibilityRole === "alert")).toHaveLength(0);
    tree.unmount();

    const failing = lastNoticeLine({
      live: true,
      audience: 254,
      last: {
        state: "fanned_out", holdCode: null, audience: 254,
        sent: 240, pending: 6, failed: 3, noEmail: 1, held: 4,
      },
    });
    expect(failing).toEqual({
      text:
        "Last update: 240 test addresses emailed · 6 still sending · 4 buyers not emailed while emails are being tested · 3 failed. Contact support.",
      failed: true,
    });
    const alerting = await mount(<EditAfterPublishBanner lastNotice={failing} />);
    expect(
      alerting.root.findAll((node) => node.props.accessibilityRole === "alert").length,
    ).toBeGreaterThanOrEqual(1);
    alerting.unmount();

    // Nothing to say: no line at all.
    expect(lastNoticeLine(null)).toBeNull();
    expect(lastNoticeLine({ live: false, audience: 3, last: null })).toBeNull();
    expect(
      lastNoticeLine({
        live: false,
        audience: 3,
        last: {
          state: "held", holdCode: "feature_off", audience: 3,
          sent: 0, pending: 0, failed: 0, noEmail: 0, held: 0,
        },
      }),
    ).toBeNull();
    const bare = await mount(<EditAfterPublishBanner />);
    expect(texts(bare).join(" ")).not.toMatch(/Last update/);
    bare.unmount();
  });

  test("BN-3: the experience editor shows one truthful line under the reason", async () => {
    expect(experienceLiveEditNotice(null)).toBe(NOT_ON);
    expect(experienceLiveEditNotice(OFF)).toBe(NOT_ON);
    expect(experienceLiveEditNotice(LIVE_254)).toBe(
      "If the dates, the route or the stop times change, we'll email your 254 buyers what changed and your reason.",
    );
    const tree = await mount(
      <EditAfterPublishExperienceBanner
        reason=""
        onReasonChange={() => undefined}
        buyerNoticeLine={experienceLiveEditNotice(null)}
      />,
    );
    expect(texts(tree)).toContain(NOT_ON);
    expect(texts(tree).join(" | ")).not.toMatch(/\bSMS\b|text message|\bpush\b/i);
    tree.unmount();
    const none = await mount(
      <EditAfterPublishExperienceBanner reason="" onReasonChange={() => undefined} />,
    );
    expect(texts(none)).not.toContain(NOT_ON);
    none.unmount();
  });
});

// ── useEventBuyerNoticeStatus ───────────────────────────────────────────────

// The query client notifies through a timer, so settle on real time rather
// than on a fixed number of microtask turns (which is not enough on a busy
// machine).
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });
  }
};

const SERVER_EVENT_ID = "11111111-1111-4111-8111-111111111111";

function StatusProbe(props: { id: string | null }): React.ReactElement {
  const status = useEventBuyerNoticeStatus(props.id);
  return React.createElement("StatusProbe", { status });
}

const mountProbe = async (
  id: string | null,
): Promise<{ tree: Renderer; client: QueryClient }> => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const tree = await mount(
    <QueryClientProvider client={client}>
      <StatusProbe id={id} />
    </QueryClientProvider>,
  );
  await flush();
  return { tree, client };
};
const probed = (tree: Renderer): unknown =>
  tree.root.findAll((node) => (node.type as unknown) === "StatusProbe")[0].props.status;

describe("issue #3827 — useEventBuyerNoticeStatus", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockAuth.isAuthReady = true;
  });

  test("ST-1: the server's answer, asked once, by the event's id, under a factory key", async () => {
    mockRpc.mockResolvedValue({
      data: { live: true, audience: 254, last: null },
      error: null,
    });
    const { tree, client } = await mountProbe(SERVER_EVENT_ID);
    expect(probed(tree)).toEqual({ live: true, audience: 254, last: null });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("business_event_buyer_notice_status", {
      p_event_id: SERVER_EVENT_ID,
    });
    expect(eventBuyerNoticeStatusKeys.detail(SERVER_EVENT_ID)).toEqual([
      "event-buyer-notice-status",
      SERVER_EVENT_ID,
    ]);
    expect(
      client.getQueryData(eventBuyerNoticeStatusKeys.detail(SERVER_EVENT_ID)),
    ).toEqual({ live: true, audience: 254, last: null });
    tree.unmount();
    client.clear();
  });

  test("ST-2: not known is null: an error, a missing function, a malformed answer", async () => {
    const answers: RpcResult[] = [
      { data: null, error: { message: "insufficient_event_permission" } },
      {
        data: null,
        error: {
          message:
            "Could not find the function public.business_event_buyer_notice_status(p_event_id) in the schema cache",
        },
      },
      { data: { audience: 254 }, error: null },
      { data: "yes", error: null },
      { data: null, error: null },
    ];
    for (const answer of answers) {
      mockRpc.mockReset();
      mockRpc.mockResolvedValue(answer);
      const { tree, client } = await mountProbe(SERVER_EVENT_ID);
      expect(probed(tree)).toBeNull();
      tree.unmount();
      client.clear();
    }
  });

  test("ST-3: with no server id, or before the session is ready, nothing is asked", async () => {
    const none = await mountProbe(null);
    expect(probed(none.tree)).toBeNull();
    none.tree.unmount();
    none.client.clear();

    mockAuth.isAuthReady = false;
    const early = await mountProbe(SERVER_EVENT_ID);
    expect(probed(early.tree)).toBeNull();
    early.tree.unmount();
    early.client.clear();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── wiring ──────────────────────────────────────────────────────────────────

const read = (relative: string): string =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const squash = (source: string): string => source.replace(/\s+/g, " ");

describe("issue #3827 — the editors are wired to the server's answer", () => {
  const screen = squash(read("../EditPublishedScreen.tsx"));
  const eventRoute = squash(read("../../../../app/event/[id]/edit.tsx"));
  const rsvpRoute = squash(read("../../../../app/rsvp/[id]/edit.tsx"));
  const wizard = squash(read("../../experience/ExperienceCreatorWizard.tsx"));

  test("WIRE-1: the event route reads the status and hands down the status, the toast and the last line", () => {
    expect(eventRoute).toContain(
      "const buyerNoticeStatus = useEventBuyerNoticeStatus( routeProps.liveEvent.serverEventId, );",
    );
    expect(eventRoute).toContain(
      "<EditPublishedEventWithBuyerCount {...routeProps} buyerNoticeStatus={buyerNoticeStatus} savedToastFor={savedToastForBuyers} lastBuyerNotice={lastNoticeLine(buyerNoticeStatus)} />",
    );
    expect(eventRoute).toContain("<EditPublishedEventWithBuyerNotice liveEvent={resolvedLiveEvent}");
    expect(eventRoute).not.toContain('"event-buyer-notice-status"');
  });

  test("WIRE-2: the RSVP route does the same, for guests", () => {
    expect(rsvpRoute).toContain(
      "const guestNoticeStatus = useEventBuyerNoticeStatus( isEditPublished ? (editorLiveEvent?.serverEventId ?? null) : null, );",
    );
    expect(rsvpRoute).toContain(
      'buyerNoticeStatus={guestNoticeStatus} savedToastFor={savedToastForGuests} lastBuyerNotice={lastNoticeLine(guestNoticeStatus, "guests")}',
    );
    expect(rsvpRoute).toContain("rsvpSavedToast(notice)");
  });

  test("WIRE-3: the editor's toasts come from the save's own buyer_notice", () => {
    expect(screen).toContain(
      "buyerNoticeToast = savedToastFor?.(atomicSaved.buyer_notice) ?? null;",
    );
    expect(screen).toContain(
      "const rsvpNoticeToast = savedToastFor?.(rsvpSaved?.buyerNotice) ?? null;",
    );
    // The RSVP toast no longer claims guests are told when nobody was.
    expect(screen).toContain(
      '} else if ((rsvpSaved?.notifiedCount ?? 0) > 0) { showToast("Saved. Going guests will be notified."); } else { showToast("Saved. Live now."); }',
    );
    expect(screen).toContain("buyerNoticeStatus={buyerNoticeStatus ?? null}");
    expect(screen).toContain('buyerNoticeNoun={rsvpMode ? "guests" : "buyers"}');
    expect(screen).toContain("lastNotice={lastBuyerNotice ?? null}");
    // The web-purchase read existed only to add a text-message promise.
    expect(screen).not.toContain("webPurchasePresent");
    expect(screen).not.toContain("useEventHasWebPurchases");
  });

  test("WIRE-4: the experience route reads the status; the wizard toasts the server's answer", () => {
    const experienceRoute = squash(read("../../../../app/experience/[id]/edit.tsx"));
    expect(experienceRoute).toContain(
      'const buyerNoticeStatus = useEventBuyerNoticeStatus( isLive && typeof eventId === "string" ? eventId : null, );',
    );
    expect(experienceRoute).toContain(
      "liveBuyerNoticeLine={ isLive ? experienceLiveEditNotice(buyerNoticeStatus) : undefined }",
    );
    expect(experienceRoute).toContain(
      "savedToastFor={isLive ? buyerNoticeSavedToast : undefined}",
    );
    expect(wizard).toContain("buyerNoticeLine={liveBuyerNoticeLine ?? null}");
    expect(wizard).toContain(
      "const buyerNoticeToast = savedToastFor?.(result?.buyer_notice) ?? null;",
    );
  });
});
