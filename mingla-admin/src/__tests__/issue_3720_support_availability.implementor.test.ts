import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AVAILABILITY_CHANGE_FAILED_MESSAGE,
  NOT_ON_SUPPORT_ROSTER_MESSAGE,
  changeSupportAvailability,
  supportAvailabilityErrorMessage,
} from "../lib/supportAvailability.js";

const read = (relative: string) => Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

// MINGLA-INVARIANT: I-3720-SUPPORT-AVAILABILITY-VISIBLE-FAILURE | issue #3720 | The "Available for support" switch never fails silently: a refused change keeps the switch where it was and shows a plain-English reason, and a confirmed change shows the server's answer.

Deno.test("#3720 availability: not on the support roster keeps the switch and says why", async () => {
  const refusal = { code: "42501", message: "not_support_staff", details: null, hint: null };
  const result = await changeSupportAvailability({
    next: true,
    current: false,
    setAvailable: () => Promise.reject(refusal),
  });
  assertEquals(result, { available: false, message: NOT_ON_SUPPORT_ROSTER_MESSAGE });
  // [TEST-MOD-APPROVED #3988] The copy now names where Support is turned on.
  assertEquals(
    NOT_ON_SUPPORT_ROSTER_MESSAGE,
    // #4130 Wave 6: People and roles is a tab of the Support page.
    "Support isn't turned on for you yet. Ask an Owner or Admin to turn it on in Support → People and roles.",
  );
});

Deno.test("#3720 availability: any other failure keeps the switch and asks to try again", async () => {
  for (const failure of [new Error("Failed to fetch"), { code: "500", message: "boom" }, null, undefined, "x"]) {
    const result = await changeSupportAvailability({
      next: false,
      current: true,
      setAvailable: () => Promise.reject(failure),
    });
    assertEquals(result, { available: true, message: AVAILABILITY_CHANGE_FAILED_MESSAGE });
  }
  assertEquals(AVAILABILITY_CHANGE_FAILED_MESSAGE, "Couldn't change your availability. Try again.");
  assertEquals(supportAvailabilityErrorMessage({ message: "not_authenticated" }), AVAILABILITY_CHANGE_FAILED_MESSAGE);
  assertEquals(supportAvailabilityErrorMessage({ message: "x", details: "not_support_staff" }), NOT_ON_SUPPORT_ROSTER_MESSAGE);
});

Deno.test("#3720 availability: a confirmed change shows the server's answer", async () => {
  const on = await changeSupportAvailability({ next: true, current: false, setAvailable: async () => true });
  assertEquals(on, { available: true, message: null });
  const off = await changeSupportAvailability({ next: false, current: true, setAvailable: async () => false });
  assertEquals(off, { available: false, message: null });
  const echoed = await changeSupportAvailability({ next: true, current: false, setAvailable: async () => undefined });
  assertEquals(echoed, { available: true, message: null });
});

Deno.test("#3720 availability: the header switch uses the guarded change and shows its message", async () => {
  const page = await read("pages/CommunitySupportPage.jsx");
  assertMatch(page, /import \{ changeSupportAvailability \} from "\.\.\/lib\/supportAvailability"/);
  const toggle = page.match(/async function toggleAvailability\(next\) \{[\s\S]*?\n  \}\n/)?.[0] ?? "";
  assert(toggle, "toggleAvailability present");
  assertMatch(toggle, /changeSupportAvailability\(\{/);
  assertMatch(toggle, /setMyAvailable\(result\.available\)/);
  assertMatch(toggle, /setAvailabilityError\(result\.message\)/);
  assertNotMatch(toggle, /setMyAvailable\(next\)/);
  assertNotMatch(toggle, /finally/);
  assertMatch(page, /role="alert"[\s\S]{0,200}\{availabilityError\}/);
});
