import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ownsRecentAdmittedScan,
  RSVP_DOOR_ANSWERS_DEADLINE_MS,
  RSVP_DOOR_FULL_ANSWERS_WINDOW_MS,
  rsvpDoorSubjectFromScanResult,
} from "../doorAnswers.ts";
import {
  DOOR_LINE_COPY,
  readDoorAnswersForSubject,
  type DoorReadClient,
} from "../../_shared/doorBookedStart.ts";

const PRIMARY = "45410000-0000-4000-8000-000000000001";
const GUEST = "45410000-0000-4000-8000-000000000002";
const ACTOR = "45410000-0000-4000-8000-000000000003";
const EVENT = "45410000-0000-4000-8000-000000000004";

Deno.test("#4541 scanner selects only an admitted primary or claimed plus-one", () => {
  assertEquals(rsvpDoorSubjectFromScanResult({
    result: "success", entityType: "primary", entityId: PRIMARY,
  }), { kind: "rsvp", id: PRIMARY });
  assertEquals(rsvpDoorSubjectFromScanResult({
    result: "duplicate", entityType: "guest", entityId: GUEST, claimed: true,
  }), { kind: "rsvp_guest", id: GUEST });
  for (const row of [
    { result: "success", entityType: "guest", entityId: GUEST, claimed: false },
    { result: "success", entityType: "guest", entityId: GUEST },
    { result: "wrong_event", entityType: "primary", entityId: PRIMARY },
    { result: "success", entityType: "primary", entityId: "not-a-uuid" },
  ]) assertEquals(rsvpDoorSubjectFromScanResult(row), null);
});

Deno.test("#4541 full answers require this actor's admitted scan in the last 30 minutes", () => {
  const now = Date.parse("2026-11-21T18:00:00.000Z");
  const base = {
    scanner_user_id: ACTOR,
    requested_event_id: EVENT,
    outcome: "success",
    scanned_at: new Date(now - RSVP_DOOR_FULL_ANSWERS_WINDOW_MS).toISOString(),
  };
  assert(ownsRecentAdmittedScan(base, ACTOR, EVENT, now));
  // #4541 R8.3: a duplicate scan is no longer a receipt (fresh admissions only).
  assertEquals(ownsRecentAdmittedScan({ ...base, outcome: "duplicate" }, ACTOR, EVENT, now), false);
  assertEquals(ownsRecentAdmittedScan({ ...base, scanner_user_id: PRIMARY }, ACTOR, EVENT, now), false);
  assertEquals(ownsRecentAdmittedScan({ ...base, requested_event_id: PRIMARY }, ACTOR, EVENT, now), false);
  assertEquals(ownsRecentAdmittedScan({ ...base, outcome: "not_found" }, ACTOR, EVENT, now), false);
  assertEquals(ownsRecentAdmittedScan({
    ...base,
    scanned_at: new Date(now - RSVP_DOOR_FULL_ANSWERS_WINDOW_MS - 1).toISOString(),
  }, ACTOR, EVENT, now), false);
  assertEquals(ownsRecentAdmittedScan({
    ...base,
    scanned_at: new Date(now + 1).toISOString(),
  }, ACTOR, EVENT, now), false);
});

Deno.test("#4541 admission stays independent of the 1.5 second optional door read", async () => {
  assertEquals(RSVP_DOOR_ANSWERS_DEADLINE_MS, 1500);
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const scanCall = source.indexOf('rpc("biz_rsvp_scan"');
  const subjectRead = source.indexOf("rsvpDoorSubjectFromScanResult(result)");
  const optionalRead = source.indexOf("readDoorAnswersForSubject(");
  assert(scanCall >= 0 && subjectRead > scanCall && optionalRead > subjectRead);
  assertStringIncludes(source, "const deadline = new AbortController()");
  assertStringIncludes(source, "setTimeout(() => deadline.abort(), RSVP_DOOR_ANSWERS_DEADLINE_MS)");
  assertStringIncludes(source, "if (doorAnswers !== null) result = { ...result, doorAnswers }");
  assert(!source.includes("return respond({ error: \"door_answers_failed\" }, 500);\n    } finally"),
    "the optional line read must not replace an admitted scan with an error");
});

Deno.test("#4541 shared reader sends the exact RSVP guest subject and fails open", async () => {
  let seen: { fn: string; args: Record<string, unknown>; signal: AbortSignal } | null = null;
  const signal = new AbortController().signal;
  const client: DoorReadClient = {
    from: () => { throw new Error("unexpected table read"); },
    rpc: (fn, args) => ({
      abortSignal: (received: AbortSignal) => {
        seen = { fn, args, signal: received };
        return Promise.resolve({
          data: { state: "answered", items: [{ label: "Diet", value: "Vegan" }] },
          error: null,
        });
      },
    }),
  };
  const view = await readDoorAnswersForSubject(
    client,
    ACTOR,
    EVENT,
    { kind: "rsvp_guest", id: GUEST },
    signal,
  );
  assertEquals(seen, {
    fn: "brand_form_door_answers",
    args: { p_actor_id: ACTOR, p_event_id: EVENT, p_subject: { kind: "rsvp_guest", id: GUEST } },
    signal,
  });
  assertEquals(view?.lines, ["Diet: Vegan"]);

  const original = console.error;
  console.error = () => {};
  try {
    const failed = await readDoorAnswersForSubject({
      from: () => { throw new Error("unexpected table read"); },
      rpc: () => ({ abortSignal: () => Promise.reject(new Error("timeout")) }),
    }, ACTOR, EVENT, { kind: "rsvp", id: PRIMARY }, signal);
    assertEquals(failed, {
      state: "unavailable",
      header: null,
      lines: [DOOR_LINE_COPY.unavailable],
      fullAnswers: false,
    });
  } finally {
    console.error = original;
  }
});

Deno.test("#4541 See all answers is bound to the authenticated recent scan receipt", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertStringIncludes(source, 'body.action === "door_full_answers"');
  assertStringIncludes(source, ".eq(\"id\", scanId)");
  assertStringIncludes(source, "ownsRecentAdmittedScan(row, actorId, eventId)");
  assertStringIncludes(source, 'rpc("brand_form_door_full_answers"');
  assertStringIncludes(source, 'p_via: "scan"');
});
