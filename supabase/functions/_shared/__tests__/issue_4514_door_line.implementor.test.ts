// MINGLA-INVARIANT: I-4514-DOOR-LINE-CAPS | issue #4514 | every door answer line (ticket scan and name admit) shows at most 3 answers, each cut to 60 characters, and an unanswered form is a line, never a refusal (_shared/__tests__/issue_4514_door_line.implementor.test.ts).
// #4514 §6 — the door line, built once on the server for the ticket scan and
// the name admit (decisions 8, 14, 15, 16). Guards I-4514-DOOR-LINE-CAPS
// (_shared/doorBookedStart.ts). Moved from the scanner's jest suite when the
// rule moved to the server.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  DOOR_LINE_COPY,
  DOOR_LINE_MAX_ITEMS,
  DOOR_LINE_MAX_VALUE,
  doorAnswersView,
  readDoorAnswers,
  type DoorReadClient,
} from "../doorBookedStart.ts";

const item = (label: string, value: string) => ({ label, value });
const EVENT = "11111111-1111-4111-8111-111111111111";
const ORDER = "44444444-4444-4444-8444-444444444444";

Deno.test("#4514 door line: the marked answers, one line each", () => {
  assertEquals(
    doorAnswersView({ state: "answered", formName: "Performers", fullAnswers: true, items: [item("Performing", "Yes"), item("Group", "4")] }),
    { state: "answered", header: null, lines: ["Performing: Yes", "Group: 4"], fullAnswers: true },
  );
});

Deno.test("#4514 door line: at most 3 door answers (decision 16)", () => {
  const view = doorAnswersView({
    state: "answered",
    items: [item("A", "1"), item("B", "2"), item("C", "3"), item("D", "4"), item("E", "5")],
  });
  assertEquals(DOOR_LINE_MAX_ITEMS, 3);
  assertEquals(view?.lines, ["A: 1", "B: 2", "C: 3"]);
});

Deno.test("#4514 door line: each answer cut to 60 characters with an ellipsis (decision 16)", () => {
  const value = (doorAnswersView({ state: "answered", items: [item("Notes", "x".repeat(200))] })?.lines[0] ?? "")
    .replace("Notes: ", "");
  assertEquals(DOOR_LINE_MAX_VALUE, 60);
  assertEquals(value.length, 60);
  assertEquals(value.endsWith("…"), true);
  assertEquals(
    doorAnswersView({ state: "answered", items: [item("Notes", "y".repeat(60))] })?.lines,
    [`Notes: ${"y".repeat(60)}`],
  );
});

Deno.test("#4514 door line: another ticket of the order is headed with the buyer's name (decision 15)", () => {
  assertEquals(
    doorAnswersView({ state: "answered", fromOrderOf: "Quinn B.", items: [item("Performing", "Yes")] })?.header,
    "From Quinn B.'s order",
  );
});

Deno.test("#4514 door line: an unanswered form is a line, never a refusal (decisions 8 and 14)", () => {
  assertEquals(doorAnswersView({ state: "not_answered", formName: "Performers" }), {
    state: "not_answered",
    header: null,
    lines: [DOOR_LINE_COPY.notAnswered],
    fullAnswers: false,
  });
});

Deno.test("#4514 door line: the host switch off means no 'See all answers'", () => {
  assertEquals(doorAnswersView({ state: "answered", fullAnswers: false, items: [item("A", "1")] })?.fullAnswers, false);
  assertEquals(doorAnswersView({ state: "answered", items: [item("A", "1")] })?.fullAnswers, false);
});

Deno.test("#4514 door line: nothing to show, or a malformed line, is null", () => {
  for (const v of [undefined, null, "x", [], {}, { state: "answered", items: [] }, { state: "answered", items: [{ label: 1 }] }]) {
    assertEquals(doorAnswersView(v), null);
  }
});

const client = (settle: () => Promise<{ data: unknown; error: unknown }>): DoorReadClient => ({
  from: () => { throw new Error("unexpected table read"); },
  rpc: () => ({ abortSignal: () => settle() }),
});
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};

Deno.test("#4514 door line: the reader caps a long SQL line too, and never throws", async () => {
  const long = { state: "answered", items: [item("A", "z".repeat(90)), item("B", "2"), item("C", "3"), item("D", "4")] };
  const signal = new AbortController().signal;
  const view = await readDoorAnswers(client(() => Promise.resolve({ data: long, error: null })), "a", EVENT, ORDER, null, signal);
  assertEquals(view?.lines.length, 3);
  assertEquals(view?.lines[0], `A: ${"z".repeat(59)}…`);
  const failed = await quiet(() =>
    readDoorAnswers(client(() => Promise.reject(new Error("boom"))), "a", EVENT, ORDER, null, signal)
  );
  assertEquals(failed, { state: "unavailable", header: null, lines: [DOOR_LINE_COPY.unavailable], fullAnswers: false });
});
