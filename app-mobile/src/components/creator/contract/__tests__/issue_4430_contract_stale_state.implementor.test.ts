// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// MINGLA-INVARIANT: I-4430-D9 | issue #4430 | a creator step the host already took counts as done; a stale-state refusal never shows the generic error and never outlives a state change
//
// FAILS-ON-REVERT: removing stale_contract_state from MESSAGES (generic error again), counting
// every stale refusal as failure, or dropping the clear-on-state-change effect fails here.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { staleOutcome, TRANSITION_TARGET } from "../contractWords.ts";
import { programErrorMessage, programErrorText, toProgramError } from "../../../../services/programResult.ts";

const app = new URL("../../../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, app));
const STALE = "stale_contract_state";

Deno.test("#4430 D-9: a step the host already took is success", () => {
  assertEquals(staleOutcome(STALE, "script_drafting", "start_script"), "success");
  assertEquals(staleOutcome(STALE, "posting", "start_posting"), "success");
  assertEquals(TRANSITION_TARGET.start_script, "script_drafting");
});

Deno.test("#4430 D-9: any other stale state shows the stale copy; other codes are never success", () => {
  assertEquals(staleOutcome(STALE, "script_sent", "start_script"), "show_stale");
  assertEquals(staleOutcome(STALE, null, "start_script"), "show_stale");
  assertEquals(staleOutcome(STALE, "script_drafting", undefined), "show_stale");
  assertEquals(staleOutcome(STALE, "script_drafting", "accept"), "show_stale");
  for (const code of ["unknown_error", "stale_state", "permission_denied", "network"]) {
    assertNotEquals(staleOutcome(code, "script_drafting", "start_script"), "success", code);
    assertEquals(staleOutcome(code, "script_drafting", "start_script"), "error", code);
  }
});

Deno.test("#4430 D-9: the server's stale_contract_state text keeps its code and state, with real words", () => {
  const e = toProgramError({ message: "stale_contract_state:script_drafting" });
  assertEquals(e.code, STALE);
  assertEquals(e.detail, "script_drafting");
  assertEquals(e.message, "This gig moved on while you were looking. Here’s where it is now.");
  assertNotEquals(programErrorText({ message: "stale_contract_state:script_drafting" }), programErrorMessage("__nope__"));
  assertEquals(toProgramError({ message: "stale_contract_state" }).code, STALE);
  assertEquals(toProgramError({ message: "permission_denied" }).detail, null);
});

Deno.test("#4430 D-9: the screen clears red errors on a state change and on pull-to-refresh, and shows the stale copy neutrally", () => {
  const screen = read("app-mobile/app/creator/contract/[contractId].tsx");
  assert(/useEffect\(\(\) => \{ setErrors\(\{\}\); \}, \[liveState\]\)/.test(screen), "errors clear when the contract state changes");
  assert(/const pull = \(\): void => \{ setErrors\(\{\}\); setStale\(null\)/.test(screen), "pull-to-refresh clears errors and the notice");
  assert(!/onRefresh=\{\(\) => void refresh\(\)\}/.test(screen), "both screens pull through the clearing handler");
  assert(/stale && stale\.state === state \? <ProgramNotice text=\{stale\.text\} \/>/.test(screen), "the stale notice is info-toned and tied to the state it was shown for");
  assert(screen.includes("staleOutcome(refused.code, refused.detail, step)"), "act decides through the pure helper");
  assert(screen.includes("'start_script')") && screen.includes("'start_posting')"), "both creator steps pass their action");
});
