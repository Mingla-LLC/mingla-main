/* eslint-disable import/first */
// issue #3827 [buyer email on a live-listing change] — tester adversarial
// proof for every word a host reads about emailing buyers.
//
// A different angle from the implementor's suite, which pins the copy of each
// named state. This file sweeps EVERY combination the copy functions can be
// handed and holds them to invariants, feeds them answers a broken or hostile
// server could send, and renders the real Review changes sheet to prove Save
// is never a dead button whatever the footer says.
//
//   INV-*  over the full matrix of status (unknown, off, on with nobody, on
//          with people), severity, field keys, noun and entity: an email is
//          promised ONLY when the server said emails are on for this brand,
//          somebody would be told, and a field it emails about changed; a row
//          is tagged only when that promise is on screen; no state names a
//          text message, a push alert or SMS.
//   RAW-*  answers that are not what the server sends (strings for numbers,
//          negative, NaN, Infinity, unknown states, arrays, null) never turn
//          into a promise.
//   TOAST-* the toast after a save promises only an email the server says it
//          scheduled, for at least one person, with a wait that is a whole
//          number of minutes between 1 and 20.
//   SAVE-* the real sheet, rendered: with a valid reason Save is enabled in
//          every footer state; with an invalid reason it is disabled.
//   EAGER-* the four eager modules (and the home tab) import none of the new
//          buyer-email modules, and nothing imports the deleted stub.
//
// FAILS-ON-REVERT (verified locally by editing, then restored):
//   - changeSummaryNotice treats an unknown status (null) as "on"   -> INV-1 red
//   - buyerNoticeSavedToast drops its `state !== "scheduled"` check -> TOAST-1 red
//   - parseBuyerNoticeStatus accepts `live: "true"`                 -> RAW-2 red
//
// Run: npx jest src/components/event/__tests__/issue_3827_buyer_email_copy.tester.adversarial.test.tsx --runInBand

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { describe, expect, jest, test } from "@jest/globals";

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

// Chrome leaves only; every copy decision stays real.
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
import {
  buyerNoticeSavedToast,
  changeSummaryNotice,
  EMAIL_MATERIAL_FIELD_KEYS,
  experienceLiveEditNotice,
  lastNoticeLine,
  parseBuyerNotice,
  parseBuyerNoticeStatus,
  type BuyerNoticeStatus,
} from "../../../utils/buyerNoticeCopy";
import type { FieldDiff } from "../../../utils/liveEventAdapter";

const LOGGED = "Changes will be logged in your event's edit history. No buyer notification.";
const NO_OTHER_CHANNEL = /\bSMS\b|text message|\btexted\b|\bpush\b|WhatsApp/i;

const STATUSES: Array<[string, BuyerNoticeStatus | null]> = [
  ["unknown", null],
  ["off", { live: false, audience: 40, last: null }],
  ["off-nobody", { live: false, audience: 0, last: null }],
  ["on-nobody", { live: true, audience: 0, last: null }],
  ["on-one", { live: true, audience: 1, last: null }],
  ["on-many", { live: true, audience: 254, last: null }],
];
const KEY_SETS: string[][] = [
  [],
  ["description"],
  ["tickets", "refundPolicy"],
  ["name", "coverHue", "visibility"],
  ["address"],
  ["date", "doorsOpen"],
  ["venueName", "tickets"],
  ["onlineUrl", "format", "description"],
  [...EMAIL_MATERIAL_FIELD_KEYS],
];
const SEVERITIES = ["material", "additive", "destructive"] as const;

// ─── INV: the copy matrix ────────────────────────────────────────────────────
describe("issue #3827 tester — the Review changes copy, every combination", () => {
  test("INV-1: an email is promised only when the server said on, somebody is there, and an emailed field changed", () => {
    let promised = 0;
    let checked = 0;
    for (const [statusLabel, status] of STATUSES) {
      for (const severity of SEVERITIES) {
        for (const fieldKeys of KEY_SETS) {
          for (const noBuyers of [false, true]) {
            for (const noun of ["buyers", "guests"] as const) {
              for (const entityLabel of ["event", "trip"] as const) {
                const notice = changeSummaryNotice({
                  loggedCopy: LOGGED, entityLabel, severity, noBuyers, fieldKeys, status, noun,
                });
                const label = JSON.stringify({ statusLabel, severity, fieldKeys, noBuyers, noun, entityLabel });
                const mayPromise =
                  entityLabel === "event" &&
                  severity === "material" &&
                  !noBuyers &&
                  status !== null && status.live && status.audience > 0 &&
                  fieldKeys.some((key) => EMAIL_MATERIAL_FIELD_KEYS.has(key));
                const promises = /We'll email/.test(notice.footer);
                checked += 1;
                if (promises) promised += 1;
                expect({ label, promises }).toEqual({ label, promises: mayPromise });
                if (promises && status !== null) {
                  expect(notice.footer).toContain(
                    `${status.audience} ${status.audience === 1 ? noun.slice(0, -1) : noun}`,
                  );
                }
                // A tag is shown only beside a footer that says people are told.
                if (notice.taggedKeys.size > 0) {
                  expect({ label, footerIsNotice: notice.footerIsNotice }).toEqual({ label, footerIsNotice: true });
                }
                for (const key of notice.taggedKeys) {
                  expect(fieldKeys).toContain(key);
                }
                expect(notice.footer).not.toMatch(NO_OTHER_CHANNEL);
                // A trip never promises anything to travellers.
                if (entityLabel === "trip") {
                  expect(notice.footer).not.toMatch(/We'll|will be (emailed|notified|alerted)/);
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(STATUSES.length * SEVERITIES.length * KEY_SETS.length * 2 * 2 * 2);
    expect(promised).toBeGreaterThan(0);
  });

  test("INV-2: an unknown status never yields the tag beside 'not switched on' on a shipped screen", () => {
    for (const fieldKeys of KEY_SETS) {
      const notice = changeSummaryNotice({
        loggedCopy: LOGGED, entityLabel: "event", severity: "material", noBuyers: false,
        fieldKeys, status: null, noun: "buyers",
      });
      expect(notice.taggedKeys.size).toBe(0);
      expect(notice.footer).not.toMatch(/We'll email/);
    }
  });

  test("INV-3: the experience line and the last-update line never promise on an unknown or off status, and never name another channel", () => {
    for (const [, status] of STATUSES) {
      const line = experienceLiveEditNotice(status);
      if (status === null || !status.live || status.audience === 0) {
        expect(line).not.toMatch(/we'll email/i);
      }
      expect(line).not.toMatch(NO_OTHER_CHANNEL);
    }
    expect(lastNoticeLine(null)).toBeNull();
    for (const state of ["logged", "superseded", "none", "something-new"]) {
      expect(lastNoticeLine({ live: true, audience: 3, last: {
        state, holdCode: null, audience: 3, sent: 3, pending: 0, failed: 0, noEmail: 0, held: 0,
      } })).toBeNull();
    }
    // A hold the host cannot act on says nothing; refund-all says why.
    for (const holdCode of ["feature_off", "event_not_live", "recorder_error", null]) {
      expect(lastNoticeLine({ live: true, audience: 3, last: {
        state: "held", holdCode, audience: 3, sent: 0, pending: 0, failed: 0, noEmail: 0, held: 0,
      } })).toBeNull();
    }
  });
});

// ─── RAW: answers that are not what the server sends ─────────────────────────
describe("issue #3827 tester — raw server answers", () => {
  test("RAW-1: a buyer_notice that is not a real one never becomes a promise", () => {
    const junk: unknown[] = [
      null, undefined, 0, "", "scheduled", [], [{ state: "scheduled", audience: 5 }],
      { state: "SCHEDULED", audience: 5 }, { state: "scheduled " , audience: 5 },
      { state: "scheduled" }, { state: "scheduled", audience: "254" }, { state: "scheduled", audience: -3 },
      { state: "scheduled", audience: Number.NaN }, { state: "scheduled", audience: Number.POSITIVE_INFINITY },
      { state: "scheduled", audience: 0 }, { state: "held", audience: 9, hold_code: "refund_all" },
      { state: "logged", audience: 9 }, { state: "fanned_out", audience: 9 }, { state: "superseded", audience: 9 },
      { state: "none", audience: 9 }, { state: "__proto__", audience: 9 },
    ];
    for (const raw of junk) {
      expect({ raw, toast: buyerNoticeSavedToast(raw) }).toEqual({ raw, toast: null });
    }
    expect(parseBuyerNotice({ state: "scheduled", audience: 2.9 })?.audience).toBe(2);
  });

  test("RAW-2: a status that is not a real one is 'not known', and not known never promises", () => {
    for (const raw of [
      null, undefined, "on", [], {}, { live: "true", audience: 5 }, { live: 1, audience: 5 },
      { audience: 5 }, { live: null, audience: 5 },
    ]) {
      expect(parseBuyerNoticeStatus(raw)).toBeNull();
    }
    const odd = parseBuyerNoticeStatus({ live: true, audience: "254", last: { state: 5 } });
    expect(odd).toEqual({ live: true, audience: 0, last: null });
    const notice = changeSummaryNotice({
      loggedCopy: LOGGED, entityLabel: "event", severity: "material", noBuyers: false,
      fieldKeys: ["address"], status: odd, noun: "buyers",
    });
    expect(notice.footer).toBe(LOGGED);
    const counts = parseBuyerNoticeStatus({ live: true, audience: 3, last: {
      state: "fanned_out", audience: -1, sent: "3", pending: Number.NaN, failed: Number.POSITIVE_INFINITY,
      noEmail: null, held: 2.5,
    } });
    expect(counts?.last).toEqual({
      state: "fanned_out", holdCode: null, audience: 0, sent: 0, pending: 0, failed: 0, noEmail: 0, held: 2,
    });
  });
});

// ─── TOAST ───────────────────────────────────────────────────────────────────
describe("issue #3827 tester — the toast after a save", () => {
  test("TOAST-1: only a scheduled email for someone; the wait is a whole number of minutes from 1 to 20", () => {
    const now = Date.parse("2027-01-15T12:00:00.000Z");
    const cases: Array<[string | null | undefined, number]> = [
      [null, 5],
      [undefined, 5],
      ["not a date", 5],
      ["2027-01-15T12:05:00.000Z", 5],
      ["2027-01-15T12:00:20.000Z", 1],
      ["2027-01-15T11:00:00.000Z", 1],
      ["2027-01-15T12:19:40.000Z", 20],
      ["2027-01-15T15:00:00.000Z", 20],
    ];
    for (const [sendAfter, minutes] of cases) {
      const toast = buyerNoticeSavedToast({ state: "scheduled", audience: 1, send_after: sendAfter }, "guests", now);
      expect(toast).toBe(
        `Saved. We'll email 1 guest in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      );
      expect(toast).not.toMatch(NO_OTHER_CHANNEL);
    }
    for (const state of ["logged", "held", "fanned_out", "superseded", "none"]) {
      expect(buyerNoticeSavedToast({ state, audience: 4, send_after: "2027-01-15T12:05:00.000Z" }, "buyers", now))
        .toBeNull();
    }
  });
});

// ─── SAVE: the real sheet, rendered ──────────────────────────────────────────
const diff = (fieldKey: string, severity: FieldDiff["severity"]): FieldDiff =>
  ({
    fieldKey,
    fieldLabel: `Label ${fieldKey}`,
    oldValue: `old ${fieldKey}`,
    newValue: `new ${fieldKey}`,
    severity,
  }) as FieldDiff;

const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

const saveButton = (tree: Renderer): TestInstance => {
  const buttons = tree.root.findAll((node) => (node.type as unknown) === "ButtonProbe");
  const found = buttons.find((node) => /save/i.test(String(node.props.label ?? node.props.title ?? textOf(node))));
  if (found === undefined) {
    throw new Error(`no Save button among ${buttons.map((b) => JSON.stringify(b.props.label)).join(", ")}`);
  }
  return found;
};

const typeReason = async (tree: Renderer, reason: string): Promise<void> => {
  const inputs = tree.root.findAll((node) => typeof node.props.onChangeText === "function");
  expect(inputs.length).toBeGreaterThan(0);
  await act(async () => {
    (inputs[0].props.onChangeText as (text: string) => void)(reason);
  });
};

describe("issue #3827 tester — Save is never a dead button", () => {
  test("SAVE-1: a valid reason enables Save in every footer state; an invalid one disables it", async () => {
    const states: Array<Partial<ChangeSummaryModalProps>> = [
      { buyerNoticeStatus: { live: true, audience: 254, last: null } },
      { buyerNoticeStatus: { live: false, audience: 254, last: null } },
      { buyerNoticeStatus: null },
      { buyerNoticeStatus: { live: true, audience: 0, last: null } },
      { buyerCount: undefined, buyerNoticeNoun: "guests", buyerNoticeStatus: null },
      { entityLabel: "trip", buyerCount: undefined, buyerNoticeStatus: null },
      { diffs: [diff("tickets", "material")], buyerNoticeStatus: { live: true, audience: 9, last: null } },
    ];
    for (const props of states) {
      const onConfirm = jest.fn();
      const tree = await mount(
        <ChangeSummaryModal
          visible
          diffs={[diff("address", "material"), diff("description", "safe")]}
          severity="material"
          onClose={() => undefined}
          onConfirm={onConfirm}
          buyerCount={3}
          {...props}
        />,
      );
      await typeReason(tree, "short");
      expect(saveButton(tree).props.disabled).toBe(true);
      await typeReason(tree, "The first room has a power fault");
      const save = saveButton(tree);
      expect({ props: Object.keys(props), disabled: save.props.disabled }).toEqual({
        props: Object.keys(props), disabled: false,
      });
      await act(async () => {
        (save.props.onPress as () => void)();
      });
      expect(onConfirm).toHaveBeenCalledWith("The first room has a power fault");
      const all = tree.root.findAll((node) => (node.type as unknown) === "Text").map(textOf).join(" | ");
      expect(all).not.toMatch(NO_OTHER_CHANNEL);
      tree.unmount();
    }
  });
});

// ─── EAGER: the boot path gains nothing ──────────────────────────────────────
describe("issue #3827 tester — eager modules", () => {
  const root = path.resolve(__dirname, "../../../..");
  const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");
  const importsOf = (source: string): string[] =>
    [...source.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g)]
      .map((match) => match[1] ?? match[2] ?? match[3]);

  test("EAGER-1: the four eager modules and the home tab import no buyer-email module and not the deleted stub", () => {
    const eager = [
      "src/store/liveEventStore.ts",
      "src/services/businessEvents.ts",
      "src/utils/liveEventAdapter.ts",
      "src/hooks/useBusinessEvents.ts",
      "app/(tabs)/home.tsx",
    ];
    for (const file of eager) {
      for (const specifier of importsOf(read(file))) {
        expect({ file, specifier }).not.toEqual({ file, specifier: expect.stringMatching(
          /buyerNoticeCopy|useEventBuyerNoticeStatus|eventChangeNotifier|eventUpdatedEmail/,
        ) });
      }
    }
  });

  test("EAGER-2: nothing in the app imports the deleted notifier stub, and the file is gone", () => {
    expect(fs.existsSync(path.join(root, "src/services/eventChangeNotifier.ts"))).toBe(false);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "__tests__") return [];
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const offenders = [...walk(path.join(root, "src")), ...walk(path.join(root, "app"))]
      .filter((file) => importsOf(fs.readFileSync(file, "utf8")).some((s) => /eventChangeNotifier/.test(s)));
    expect(offenders).toEqual([]);
  });
});
