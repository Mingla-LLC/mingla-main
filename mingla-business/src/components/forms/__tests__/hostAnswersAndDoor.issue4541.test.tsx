/**
 * #4541 wave 2, Host:
 *   R1.9  "Answers to {form}" on guest detail and order detail, in every state.
 *   R8.3  the "Door" tab's log of who opened full answers, and the builder's
 *         "Invited door staff can too" switch.
 *   R1.8  "Forms are paused right now. Try again later." on Ask and Remind.
 *
 * FAILS-ON-REVERT: dropping a card state, the door log's empty line, the
 * detail screens' card mount, the invited switch, or the forms_paused copy
 * turns a named case RED.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findAll: (p: (n: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: Node; toJSON: () => unknown; unmount: () => void };
  act: (cb: () => void) => void;
};

type Q = { isPending?: boolean; isLoading: boolean; isError: boolean; data: unknown; error?: unknown; refetch: () => void };
let guestAnswersQuery: Q = { isLoading: true, isError: false, data: undefined, refetch: jest.fn() };
let doorReadsQuery: Q = { isLoading: true, isError: false, data: undefined, refetch: jest.fn() };
let rank = 100;

jest.mock("../../../hooks/useBrandForms", () => ({
  useGuestAnswers: () => guestAnswersQuery,
  useDoorReads: () => doorReadsQuery,
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank, isLoading: false }) }));
jest.mock("../useFormsToast", () => ({
  errorSentence: (_e: unknown, fallback: string) => fallback,
}));
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Button: (props: Record<string, unknown>) => R.createElement("Button", props) };
});

import { GuestAnswersCard } from "../GuestAnswersCard";
import { DoorReadLog, doorReadLine } from "../DoorReadLog";
import { parseDoorReads, parseGuestAnswers } from "../../../services/brandFormsService";
import { brandFormKeys } from "../../../hooks/brandFormKeys";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const texts = (root: Node): string[] =>
  root.findAll((n) => n.type === "Text").map((n) =>
    React.Children.toArray(n.props.children as React.ReactNode).filter((c) => typeof c === "string").join(""),
  );

const mount = (el: React.ReactElement): { root: Node; toJSON: () => unknown; unmount: () => void } => {
  let r: { root: Node; toJSON: () => unknown; unmount: () => void } | null = null;
  act(() => {
    r = create(el);
  });
  if (r === null) throw new Error("not mounted");
  return r;
};

const card = (): React.ReactElement => (
  <GuestAnswersCard brandId="b1" eventId="e1" subject={{ kind: "order", id: "o1" }} />
);

describe("#4541 R1.9 the answers card", () => {
  test("parses the three server states", () => {
    expect(parseGuestAnswers({ state: "none" })).toEqual({ state: "none" });
    expect(parseGuestAnswers({ state: "not_answered" })).toEqual({ state: "not_answered" });
    expect(
      parseGuestAnswers({
        formName: "Guest details", versionLabel: "v2", answeredAt: "2026-11-20T10:00:00Z", isCurrentVersion: false,
        items: [{ label: "Diet", value: "Vegan" }],
      }),
    ).toEqual({
      state: "answered", formName: "Guest details", versionLabel: "v2", answeredAt: "2026-11-20T10:00:00Z",
      isCurrentVersion: false, items: [{ label: "Diet", value: "Vegan" }],
    });
    expect(brandFormKeys.guestAnswers("e1", "order", "o1")).toEqual(["brand-forms", "guest-answers", "e1", "order", "o1"]);
  });

  test("loading, error with Try again, not answered, none, answered", () => {
    guestAnswersQuery = { isPending: true, isLoading: true, isError: false, data: undefined, refetch: jest.fn() };
    expect(texts(mount(card()).root)).toContain("Loading answers…");

    // While auth settles the query is disabled: pending, not fetching
    // (isLoading false), no data. That is loading, never the error state.
    guestAnswersQuery = { isPending: true, isLoading: false, isError: false, data: undefined, refetch: jest.fn() };
    const settling = texts(mount(card()).root);
    expect(settling).toContain("Loading answers…");
    expect(settling).not.toContain("Couldn't load answers. Try again");

    const refetch = jest.fn();
    guestAnswersQuery = { isPending: false, isLoading: false, isError: true, data: undefined, refetch };
    const err = mount(card());
    expect(texts(err.root)).toContain("Couldn't load answers. Try again");
    const retry = err.root.findAll((n) => n.type === "Button")[0];
    act(() => retry?.props.onPress());
    expect(refetch).toHaveBeenCalled();

    guestAnswersQuery = { isPending: false, isLoading: false, isError: false, data: { state: "not_answered" }, refetch: jest.fn() };
    expect(texts(mount(card()).root)).toContain("Not answered");

    guestAnswersQuery = { isPending: false, isLoading: false, isError: false, data: { state: "none" }, refetch: jest.fn() };
    expect(mount(card()).toJSON()).toBeNull();

    guestAnswersQuery = {
      isPending: false, isLoading: false, isError: false, refetch: jest.fn(),
      data: { state: "answered", formName: "Guest details", versionLabel: null, answeredAt: null, isCurrentVersion: true,
        items: [{ label: "Diet", value: "Vegan" }, { label: "Song", value: "" }] },
    };
    const answered = texts(mount(card()).root);
    expect(answered).toEqual(expect.arrayContaining(["Answers to Guest details", "Diet", "Vegan", "Song", "Not answered"]));
  });

  test("below marketing manager the card draws nothing", () => {
    rank = 10;
    guestAnswersQuery = { isLoading: false, isError: false, data: { state: "not_answered" }, refetch: jest.fn() };
    expect(mount(card()).toJSON()).toBeNull();
    rank = 100;
  });

  test("guest detail and order detail mount it through the one forms owner, for the order", () => {
    for (const rel of ["mingla-business/app/event/[id]/guests/[guestId].tsx", "mingla-business/app/event/[id]/orders/[oid]/index.tsx"]) {
      const src = read(rel);
      expect(src).toMatch(/import\("[./]+\/src\/components\/forms\/formsOwner"\)\.then\(\(m\) => \(\{\s*default: m\.GuestAnswersCard/);
      expect(src).toMatch(/<GuestAnswersCard[\s\S]{0,200}subject=\{\{ kind: "order", id: order\.id \}\}/);
    }
    expect(read("mingla-business/src/components/forms/formsOwner.ts")).toContain('export { GuestAnswersCard } from "./GuestAnswersCard";');
  });
});

describe("#4541 R8.3 who opened answers at the door", () => {
  test("parses rows and words each line", () => {
    const rows = parseDoorReads([{ at: "2026-11-21T20:00:00Z", actorName: "Tobi", guestName: "Ada", via: "scan", result: "full" }]);
    expect(rows).toHaveLength(1);
    expect(doorReadLine(rows[0]!, () => "8pm")).toBe("Tobi opened Ada's answers · 8pm");
    expect(doorReadLine({ ...rows[0]!, actorName: null, guestName: " " }, () => "8pm")).toBe(
      "Someone opened a guest's answers · 8pm",
    );
    expect(brandFormKeys.doorReads("e1")).toEqual(["brand-forms", "door-reads", "e1"]);
  });

  test("empty, rows and error states", () => {
    doorReadsQuery = { isLoading: false, isError: false, data: [], refetch: jest.fn() };
    expect(texts(mount(<DoorReadLog eventId="e1" />).root)).toContain("No one has opened answers at the door yet.");
    doorReadsQuery = {
      isLoading: false, isError: false, refetch: jest.fn(),
      data: [{ at: "2026-11-21T20:00:00Z", actorName: "Tobi", guestName: "Ada", via: "scan", result: "full" }],
    };
    const withRows = texts(mount(<DoorReadLog eventId="e1" />).root);
    expect(withRows.some((t) => t.startsWith("Tobi opened Ada's answers · "))).toBe(true);
    doorReadsQuery = { isLoading: false, isError: true, data: undefined, error: new Error("x"), refetch: jest.fn() };
    expect(mount(<DoorReadLog eventId="e1" />).root.findAll((n) => n.props.testID === "door-read-log-error").length).toBeGreaterThan(0);
  });

  test("Responses shows a Door tab to event managers with one page picked; the builder has the invited switch", () => {
    const responses = read("mingla-business/src/components/forms/BrandFormResponsesScreen.tsx");
    expect(responses).toMatch(/const showDoor = canAttachGuestQuestions\(role\.rank\) && eventId !== null;/);
    expect(responses).toMatch(/<DoorReadLog eventId=\{eventId\} \/>/);
    const builder = read("mingla-business/src/components/forms/BrandFormBuilderScreen.tsx");
    expect(builder).toContain('testID="brand-form-door-invited-switch"');
    expect(builder).toMatch(/disabled=\{doorInvited\.isPending \|\| !form\.doorFullAnswers\}/);
    const copy = read("mingla-business/src/components/forms/brandFormsCopy.ts");
    expect(copy).toContain('doorInvitedTitle: "Invited door staff can too"');
    expect(copy).toContain('doorInvitedLine: "Off: people you invited only to scan see the marked answers only."');
  });
});

describe("#4541 R1.8 forms paused", () => {
  test("Ask and Remind say so in plain words", () => {
    const svc = read("mingla-business/src/services/brandFormRequestService.ts");
    expect(svc).toContain('forms_paused: "Forms are paused right now. Try again later."');
  });
});

describe("#4541 R7.3 / design v10 I3 the builder's warning and the retention line", () => {
  test("the warning and the retention line read exactly; the builder shows both", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const copy = require("../brandFormsCopy") as typeof import("../brandFormsCopy");
    expect(copy.FORMS_COPY.sensitiveWarning).toBe(
      "Only ask what you need. Don't ask for ID numbers, medical records or card details.",
    );
    expect(copy.retentionLine(true)).toBe("Answers are erased 12 months after the event ends.");
    expect(copy.retentionLine(false)).toBe("Answers are erased 12 months after they're sent.");
    const builder = read("mingla-business/src/components/forms/BrandFormBuilderScreen.tsx");
    expect(builder).toMatch(/<FormsNotice tone="info" title=\{FORMS_COPY\.sensitiveWarning\} testID="brand-form-sensitive-warning" \/>\s*<IntakeSchemaBuilder/);
    expect(builder).toContain("retentionLine((detail.data?.attachments.length ?? 0) > 0)");
  });
});
