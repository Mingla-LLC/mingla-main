// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// MINGLA-INVARIANT: I-4445-1 | issue #4445 | the closed Local pick card says "Picks for this month are closed" once, in the title; the body only says when the next window opens
// MINGLA-INVARIANT: I-4445-2 | issue #4445 | a blocked Apply on the Local form scrolls to and focuses the first field with an error, through one shared helper on ProgramScreen and ProgramField
// MINGLA-INVARIANT: I-4445-3 | issue #4445 | the creator profile "Pick at least one." error shows only after a Save tap or a chip tap, never from the name box, and its row keeps a fixed height
// MINGLA-INVARIANT: I-4445-4 | issue #4445 | a Local whose seat status is ended sees the ended home with History and pay and Payout account, and no Pick or visit action
// MINGLA-INVARIANT: I-4445-5 | issue #4445 | a profile read that fails with 42501 after sign-out is ignored; any other failure, or a 42501 with the session still live, is still logged as an error
//
// FAILS-ON-REVERT: restoring the doubled closed words, an unwired Apply, the shared touched flag,
// the normal home for an ended seat, or an unconditional "Profile load failed" fails here.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { pickWindowWords } from "../../../utils/programFormat.ts";
import { ENDED_COPY, localSeatEnded } from "../localWords.ts";
import { firstErrorKey, scrollTargetY } from "../../programs/formFocus.ts";
import { nichesErrorVisible } from "../../creator/profileErrors.ts";
import { isSignedOutProfileError } from "../../../utils/signedOutProfileError.ts";

const app = new URL("../../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, app));
const NOW = new Date(2026, 10, 15, 12);

Deno.test("#4445-1: closed body is only the next date, never the title again", () => {
  const w = pickWindowWords({ open: false, opens_on: "2026-12-01" }, null, NOW);
  assertEquals(w.headline, "The next window opens on Tue Dec 1.");
  assert(!/closed/i.test(w.headline));
  assertEquals(pickWindowWords({ open: false }, null, NOW).headline, "Check back next month.");
  const index = read("app-mobile/app/local/index.tsx");
  assert(index.includes("'Picks for this month are closed'"), "title keeps the words once");
});

Deno.test("#4445-2: first error in screen order, scroll target never negative", () => {
  const order = ["city", "accounts", "links", "why"] as const;
  assertEquals(firstErrorKey(order, { why: true, accounts: true }), "accounts");
  assertEquals(firstErrorKey(order, { why: true }), "why");
  assertEquals(firstErrorKey(order, {}), null);
  assertEquals(scrollTargetY(500), 484);
  assertEquals(scrollTargetY(5), 0);
});

Deno.test("#4445-2: source guard — Apply scrolls via the shared helper, screen and field expose refs", () => {
  const index = read("app-mobile/app/local/index.tsx");
  assert(index.includes("scrollToFirstError(APPLY_FIELD_ORDER"));
  assert(index.includes("scrollRef={scrollRef}"));
  assert(index.includes("layoutOf('why')") && index.includes("inputOf('why')"));
  const ui = read("app-mobile/src/components/programs/ProgramUi.tsx");
  assert(ui.includes("ref={scrollRef}") && ui.includes("ref={inputRef as never}"));
});

Deno.test("#4445-3: chip error needs a save attempt or a chip tap", () => {
  assertEquals(nichesErrorVisible(false, false, 0), false, "name blur alone shows nothing");
  assertEquals(nichesErrorVisible(true, false, 0), true);
  assertEquals(nichesErrorVisible(false, true, 0), true);
  assertEquals(nichesErrorVisible(true, true, 2), false);
});

Deno.test("#4445-3: source guard — name blur does not drive the chip error; row is reserved", () => {
  const p = read("app-mobile/app/creator/setup/profile.tsx");
  assert(p.includes("nichesErrorVisible(attempted, nichesTouched, niches.length)"));
  assert(!/touched && niches\.length === 0/.test(p));
  assert(p.includes("minHeight: 18"));
});

Deno.test("#4445-4: ended seat words and routing", () => {
  assert(localSeatEnded({ status: "ended" }));
  assert(!localSeatEnded({ status: "active" }) && !localSeatEnded(null));
  assertEquals(ENDED_COPY.title, "Your Mingla Local seat has ended");
  const index = read("app-mobile/app/local/index.tsx");
  const route = index.indexOf("localSeatEnded(landing.data.local)");
  assert(route > 0 && route < index.indexOf("<LocalAgreementSign landing"), "ended wins over the agreement step");
  const ended = index.slice(index.indexOf("function LocalEnded"), index.indexOf("function ChangesCard") > 0 ? index.indexOf("/** #4430 L-3") : undefined);
  assert(ended.includes("<HistoryAndPay") && !ended.includes("<PickPlace") && !ended.includes("<MarkVisited"));
  assert(index.includes("Payout account"));
});

Deno.test("#4445-5: only a 42501 after sign-out is ignored", () => {
  assert(isSignedOutProfileError({ code: "42501" }, "u1", null));
  assert(isSignedOutProfileError({ code: "42501" }, "u1", "u2"));
  assert(!isSignedOutProfileError({ code: "42501" }, "u1", "u1"), "session still live: real error");
  assert(!isSignedOutProfileError({ code: "PGRST116" }, "u1", null));
  assert(!isSignedOutProfileError(null, "u1", null));
  const hook = read("app-mobile/src/hooks/useAuthSimple.ts");
  assert(hook.indexOf("isSignedOutProfileError(profileError") < hook.indexOf("logger.error('Profile load failed'"));
});
