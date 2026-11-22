/**
 * #4541 T-39 (SC-34 UI; R4.7, R4.8, R4.9) — Unknown Blast replies in Responses.
 *
 *   - The filter row All · Known · Unknown asks the server for that owner, and
 *     "Show hidden (n)" for the hidden ones (keys fold both into the filter).
 *   - An Unknown reply reads "Unknown" with "From {campaign} · {date}"; a Blast
 *     recipient keeps their name with "From {campaign}". No "Unverified" chip.
 *   - "Hide reply" hides an Unknown reply; the toast offers Undo for 6 s, and
 *     Undo brings it back.
 *   - Export works under All pages; the CSV gains the Campaign column and the
 *     name "Unknown".
 *   - The Forms list card shows "{n} Blast replies".
 *
 * FAILS-ON-REVERT: dropping the owner/showHidden arguments, the Unknown line,
 * the hide mutation or its Undo action, the export's All pages path, or the
 * Blast replies line turns a named case RED.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findAll: (p: (n: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: Node; unmount: () => void };
  act: (cb: () => void) => void;
};

type Row = import("../../../services/brandFormsService").BrandFormResponseRow;
const responsesInputs: Array<Record<string, unknown>> = [];
const hideMutate = jest.fn<(v: { responseId: string; hidden: boolean }, o: { onSuccess?: () => void; onError?: (e: Error) => void }) => void>();
const shown: Array<{ kind: string; message: string; options?: { action?: { label: string; onPress: () => void }; autoDismissMs?: number | null } }> = [];
const exportCalls: Array<Record<string, unknown>> = [];
let rows: Row[] = [];
let hiddenCount = 0;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ formId: "f1", tab: "responses" }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 100, isLoading: false }) }));
jest.mock("../../../hooks/useBrandForms", () => ({
  useBrandFormDetail: () => ({
    data: {
      form: { id: "f1", brandId: "b1", name: "Open mic", status: "live", liveVersionId: "v1" },
      version: 1,
      published: null,
      attachments: [
        { id: "a1", eventId: "e1", eventName: "Detty", eventType: "event", mode: "optional_on_page", autoRemind: false, autoRemindChannels: [] },
        { id: "a2", eventId: "e2", eventName: "Lagos", eventType: "event", mode: "optional_on_page", autoRemind: false, autoRemindChannels: [] },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useBrandFormResponses: (input: Record<string, unknown>) => {
    responsesInputs.push(input);
    return {
      data: {
        form: { id: "f1", name: "Open mic", status: "live", liveVersionId: "v1", doorFullAnswers: true },
        mode: null, versions: {}, total: rows.length, counts: {}, rows, notAnswered: [], hiddenCount,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    };
  },
  useBrandFormCounts: () => ({ data: { forms: [], pages: [] }, isError: false }),
  useCloseBrandForm: () => ({ isPending: false, mutate: jest.fn() }),
  useReopenBrandForm: () => ({ isPending: false, mutate: jest.fn() }),
  useHideBrandFormResponse: () => ({ isPending: false, mutate: hideMutate }),
}));
jest.mock("../../../services/brandFormsExportService", () => ({
  exportFormAnswers: (input: Record<string, unknown>) => {
    exportCalls.push(input);
    return Promise.resolve("downloaded");
  },
}));
jest.mock("../useFormsToast", () => ({
  useFormsToast: () => ({
    show: (kind: string, message: string, options?: Record<string, unknown>) => shown.push({ kind, message, options: options as never }),
    toast: null,
  }),
  errorSentence: (_e: unknown, f: string) => f,
}));
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Button: (props: Record<string, unknown>) => R.createElement("Button", props, props.children as React.ReactNode) };
});
jest.mock("../../ui/EmptyState", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { EmptyState: (props: Record<string, unknown>) => R.createElement("EmptyState", props, props.children as React.ReactNode) };
});
jest.mock("../../ui/GlassCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { GlassCard: (props: Record<string, unknown>) => R.createElement("GlassCard", props, props.children as React.ReactNode) };
});
jest.mock("../../ui/IconChrome", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { IconChrome: (props: Record<string, unknown>) => R.createElement("IconChrome", props, props.children as React.ReactNode) };
});
jest.mock("../../ui/ConfirmDialog", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { ConfirmDialog: (props: Record<string, unknown>) => R.createElement("ConfirmDialog", props, props.children as React.ReactNode) };
});
jest.mock("../../ui/Tabs", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Tabs: (props: Record<string, unknown>) => R.createElement("Tabs", props, props.children as React.ReactNode) };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      R.createElement("Sheet", { visible }, visible ? children : null),
  };
});
jest.mock("../../ui/SheetScrollLayout", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    SheetScrollLayout: ({ children }: { children?: React.ReactNode }) => R.createElement("SheetScrollLayout", null, children),
  };
});
jest.mock("../../ui/Pill", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    Pill: ({ children }: { children?: React.ReactNode }) => R.createElement("Pill", null, children),
    Chip: (props: Record<string, unknown>) => R.createElement("Chip", props),
  };
});
jest.mock("../DoorReadLog", () => ({ DoorReadLog: () => null }));
jest.mock("../FormRequestLog", () => ({ FormRequestLog: () => null }));
jest.mock("../FormRequestSheet", () => ({ FormRequestSheet: () => null }));
jest.mock("../GuestQuestionsSheet", () => ({ GuestQuestionsSheet: () => null }));
jest.mock("../FormsNotice", () => ({ FormsNotice: () => null }));

import { BrandFormResponsesScreen, responseRowLine } from "../BrandFormResponsesScreen";
const { buildAnswersCsv } = jest.requireActual<typeof import("../../../services/brandFormsExportService")>(
  "../../../services/brandFormsExportService",
);
const { responsesFilterKey } = jest.requireActual<typeof import("../../../hooks/useBrandForms")>("../../../hooks/useBrandForms");
import { brandFormKeys } from "../../../hooks/brandFormKeys";
import { FORMS_COPY } from "../brandFormsCopy";

const base = (over: Partial<Row>): Row => ({
  responseId: "r1", versionId: "v1", version: 1, earlierVersion: false, answers: {}, source: "page",
  verified: true, viaLink: false, editCount: 0, submittedAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z",
  subject: { kind: "rsvp", id: "x", name: "Amara N." }, holder: null,
  ownerKind: "guest", ownerName: null, campaignId: null, campaignName: null, hidden: false, ...over,
});
const unknownRow = base({
  responseId: "u1", verified: false, subject: { kind: "contact", id: null, name: "Unknown" },
  ownerKind: "unknown", ownerName: "Unknown", campaignId: "c1", campaignName: "December drop",
});
const blastRow = base({
  responseId: "k1", subject: { kind: "contact", id: null, name: "Ada O." },
  ownerKind: "blast", ownerName: "Ada O.", campaignId: "c1", campaignName: "December drop",
});

const texts = (root: Node): string[] =>
  root.findAll((n) => n.type === "Text").map((n) =>
    React.Children.toArray(n.props.children as React.ReactNode).filter((c) => typeof c === "string").join(""),
  );
const mount = (): { root: Node; unmount: () => void } => {
  let r: { root: Node; unmount: () => void } | null = null;
  act(() => {
    r = create(<BrandFormResponsesScreen />);
  });
  if (r === null) throw new Error("not mounted");
  return r;
};
const press = (root: Node, testID: string): void => {
  const node = root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  if (node === undefined) throw new Error(`no ${testID}`);
  act(() => node.props.onPress());
};

beforeEach(() => {
  responsesInputs.length = 0;
  hideMutate.mockReset();
  shown.length = 0;
  exportCalls.length = 0;
  rows = [unknownRow, blastRow, base({})];
  hiddenCount = 0;
});

describe("#4541 R4.7 Unknown and Blast replies in the list", () => {
  test("Unknown reads 'Unknown' with 'From {campaign} · {date}'; a Blast recipient keeps the name; no Unverified chip", () => {
    const r = mount();
    const t = texts(r.root);
    expect(t).toContain("Unknown");
    expect(t.some((x) => x.startsWith("From December drop · "))).toBe(true);
    expect(t).toContain("Ada O.");
    expect(t).toContain("From December drop");
    expect(r.root.findAll((n) => n.type === "Chip" && n.props.label === "Unverified")).toHaveLength(0);
    expect(responseRowLine(blastRow)).toBe("From December drop");
    r.unmount();
  });

  test("the filter row asks the server for Known or Unknown; Show hidden appears with hidden replies", () => {
    hiddenCount = 2;
    const r = mount();
    expect(responsesInputs.at(-1)).toMatchObject({ owner: "all", showHidden: false });
    press(r.root, "brand-form-owner-unknown");
    expect(responsesInputs.at(-1)).toMatchObject({ owner: "unknown" });
    press(r.root, "brand-form-owner-known");
    expect(responsesInputs.at(-1)).toMatchObject({ owner: "known" });
    const hidden = r.root.findAll((n) => n.type === "Chip" && n.props.testID === "brand-form-show-hidden")[0];
    expect(hidden?.props.label).toBe("Show hidden (2)");
    press(r.root, "brand-form-show-hidden");
    expect(responsesInputs.at(-1)).toMatchObject({ showHidden: true });
    expect(brandFormKeys.responses("f1", null, responsesFilterKey("all", "unknown", true)))
      .toEqual(["brand-forms", "responses", "f1", "all", "all:unknown:1"]);
    r.unmount();
  });
});

describe("#4541 R4.8 hide with undo", () => {
  test("Hide reply on an Unknown reply; the toast's Undo brings it back", () => {
    hideMutate.mockImplementation((_v, o) => o.onSuccess?.());
    const r = mount();
    press(r.root, "brand-form-response-u1");
    press(r.root, "brand-form-hide-reply");
    expect(hideMutate.mock.calls[0]?.[0]).toEqual({ responseId: "u1", hidden: true });
    const toast = shown.at(-1);
    expect(toast?.message).toBe("Reply hidden");
    expect(toast?.options?.autoDismissMs).toBe(6000);
    expect(toast?.options?.action?.label).toBe("Undo");
    act(() => toast?.options?.action?.onPress());
    expect(hideMutate.mock.calls[1]?.[0]).toEqual({ responseId: "u1", hidden: false });
    r.unmount();
  });

  test("a guest's answer has no Hide reply", () => {
    const r = mount();
    press(r.root, "brand-form-response-r1");
    expect(r.root.findAll((n) => n.props.testID === "brand-form-hide-reply")).toHaveLength(0);
    r.unmount();
  });
});

describe("#4541 R4.7 export and R4.9 the list card", () => {
  test("Export works under All pages (no page picked)", () => {
    const r = mount();
    press(r.root, "brand-form-export");
    expect(exportCalls[0]).toMatchObject({ formId: "f1", eventId: null });
    r.unmount();
  });

  test("the CSV names Unknown and the campaign", () => {
    const csv = buildAnswersCsv(
      {
        columns: [{ key: "1:q1", version: 1, questionId: "q1", label: "Act", type: "short_text" }],
        rows: [{ responseId: "u1", name: "Unknown", campaign: "December drop", version: 1, submittedAt: "s", updatedAt: "u", verified: false, values: {} }],
      },
      new Map(),
    );
    expect(csv.split("\r\n")[1]).toBe("Unknown,December drop,s,u,1,No,");
  });

  test("'{n} Blast replies' wording", () => {
    expect(FORMS_COPY.blastReplies(3)).toBe("3 Blast replies");
    expect(FORMS_COPY.blastReplies(1)).toBe("1 Blast reply");
  });
});
