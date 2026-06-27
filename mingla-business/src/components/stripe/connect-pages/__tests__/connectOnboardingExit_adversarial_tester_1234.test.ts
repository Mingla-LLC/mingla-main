/**
 * ADVERSARIAL test — mingla-tester, META-ORCH-1234 Bug B.
 *
 * The fix: ConnectOnboardingBody.web.tsx must NEVER client-side `router.replace`
 * (or push) into the auth-gated `/brand/<id>/payments` route from the sessionless
 * onboarding browser. It must persist `return_to` on mount and, on exit, recover
 * it + do a FULL-PAGE navigation (window.location.assign), with a fallback to the
 * sessionless-safe `/stripe-onboarding-return` relay.
 *
 * Rather than re-render the heavy Stripe-DOM component under jsdom, this pins the
 * exit CONTRACT against the actual source file: the invariants are read straight
 * from disk so a revert flips this test red (fails-on-revert), from a DIFFERENT
 * angle than the implementor's strict-grep .mjs gate.
 */
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(__dirname, "..", "ConnectOnboardingBody.web.tsx"),
  "utf8",
);

// Strip block + line comments so we assert against EXECUTABLE code, not prose.
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("META-ORCH-1234 Bug B — onboarding exit never strands the user", () => {
  test("handleExit never SPA-replaces/pushes into the auth-gated /brand/<id>/payments route", () => {
    // No client-side router navigation at all (useRouter was removed).
    expect(CODE).not.toMatch(/router\s*\.\s*replace\s*\(/);
    expect(CODE).not.toMatch(/router\s*\.\s*push\s*\(/);
    // No navigation target into the payments route in executable code.
    expect(CODE).not.toMatch(/\/brand\/[^"'`]*\/payments/);
    expect(CODE).not.toMatch(/payments['"`]/);
  });

  test("return_to is persisted to sessionStorage on mount", () => {
    expect(CODE).toMatch(/sessionStorage\s*\.\s*setItem/);
    expect(CODE).toMatch(/mingla:stripe-connect:onboarding-return-to/);
    // persisted from a mount effect
    expect(CODE).toMatch(/useEffect\s*\(/);
  });

  test("exit recovers return_to (param OR sessionStorage) and FULL-PAGE navigates", () => {
    expect(CODE).toMatch(/sessionStorage\s*\.\s*getItem/);
    expect(CODE).toMatch(/window\s*\.\s*location\s*\.\s*assign\s*\(/);
  });

  test("no-return_to fallback targets the sessionless-safe /stripe-onboarding-return relay", () => {
    expect(CODE).toMatch(/\/stripe-onboarding-return/);
    // and it carries the native deep link so the relay can bounce the browser
    expect(CODE).toMatch(/mingla-business:\/\/onboarding-complete/);
  });

  test("the exit handler exists and is wired to Stripe onExit", () => {
    expect(CODE).toMatch(/const\s+handleExit\s*=/);
    expect(CODE).toMatch(/onExit\s*=\s*\{?\s*handleExit/);
  });
});
