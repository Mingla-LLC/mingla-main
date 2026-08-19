/**
 * issue #2333 [online-event-publish] — S4b/S4c wiring proofs (SPEC §7 T-14, T-19).
 *
 * These two assertions live at a SOURCE level rather than a mounted-component level,
 * and the reason is worth stating so nobody mistakes it for laziness: both components
 * are RN screens with ~90 transitive imports (expo-router, react-native-gesture-handler,
 * the Zustand stores, the deferred TurnoutIntelProvider). This package's default jest
 * config is `testEnvironment: "node"` with NO react-native-testing-library — mounting
 * either one needs the dedicated render configs (see EditPublishedTripScreen.render.README.md).
 *
 * So the BEHAVIOURAL half of S4b/S4c is proved by execution in the sibling suite
 * (issue2333OnlinePublishGuards.happy.test.ts): `describeUnmappedPublishGuard` and the
 * `city_required` → `edit_where` copy resolution are real function calls with real
 * assertions. What is left, and what this file covers, is the WIRING — that the wizard
 * actually calls the helper instead of the old literal, and that `edit_where` lands on
 * the step that is really the Where step.
 *
 * The STEP_DEFS assertion is the one that carries the most information and is NOT a
 * tautology: it fails if anyone reorders the wizard steps, which would silently send a
 * "fix your location" jump to the Cover step with every test still green.
 *
 * fails-on-revert (TRUE LINE DELETION):
 *   * restore `handleShowToast("Could not save this publish. Try again.")` in
 *     EventCreatorWizard.tsx → the S4b block goes red.
 *   * delete the `case "edit_where"` arm → the Fix-jump block goes red.
 *   * delete the `liveEvent.format === "online"` branch from EditPublishedScreen.tsx →
 *     the S4c block goes red.
 *
 * CI: .github/workflows/issue-2333-online-event-publish.yml.
 */

import fs from "node:fs";
import path from "node:path";

const WIZARD_PATH = path.resolve(__dirname, "..", "EventCreatorWizard.tsx");
const EDIT_PATH = path.resolve(__dirname, "..", "EditPublishedScreen.tsx");

const readWizard = (): string => fs.readFileSync(WIZARD_PATH, "utf8");
const readEdit = (): string => fs.readFileSync(EDIT_PATH, "utf8");

/** Strip // line comments and block comments so a doc-comment mentioning a string
 *  can never satisfy (or break) an assertion about executable code. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("issue #2333 S4b — the wizard stops telling hosts to retry the impossible", () => {
  test("the literal 'Could not save this publish. Try again.' is GONE from the publish catch", () => {
    const code = stripComments(readWizard());
    expect(code).not.toContain("Could not save this publish. Try again.");
  });

  test("no executable line in the wizard invites a retry for a server guard", () => {
    const code = stripComments(readWizard());
    // The publish-guard catch block, from the resolver to the end of the callback.
    const start = code.indexOf("resolveProviderNeutralPaidPublishGuardCopy(code)");
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(start, start + 2000);
    expect(block).not.toMatch(/Try again/i);
  });

  test("the fallback routes through the shared, tested helper", () => {
    const code = stripComments(readWizard());
    expect(code).toContain("handleShowToast(describeUnmappedPublishGuard(code))");
    expect(code).toContain("describeUnmappedPublishGuard,");
  });
});

describe("issue #2333 S4b — Fix-jump for city_required lands on the Where step (T-14)", () => {
  test("the guard action switch has an edit_where arm that jumps to step 2", () => {
    const code = stripComments(readWizard());
    const arm = code.match(
      /case "edit_where":[\s\S]{0,200}?setCurrentStep\(2\);/,
    );
    expect(arm).not.toBeNull();
  });

  test("the same arm reveals step errors, so the host sees WHICH field", () => {
    const code = stripComments(readWizard());
    const arm = code.match(
      /case "edit_where":([\s\S]{0,200}?)break;/,
    );
    expect(arm).not.toBeNull();
    expect(arm![1]).toContain("setShowStepErrors(true)");
    expect(arm![1]).toContain("setCurrentStep(2)");
  });

  test("step index 2 IS the Where step — a reorder must fail here, not silently in prod", () => {
    // The assertion that carries real information. `edit_where` is a hardcoded index;
    // if STEP_DEFS is ever reordered, the jump would land on Cover with every other
    // test still green.
    const src = readWizard();
    const defs = src.match(/const STEP_DEFS[\s\S]*?\n\];/);
    expect(defs).not.toBeNull();
    const titles = [...defs![0].matchAll(/\{\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(titles[2]).toBe("Where");
    // And the date jump the pre-existing edit_date arm uses.
    expect(titles[1]).toBe("When");
  });

  test("the switch is exhaustive with a never default, so a new action cannot silently reuse a jump", () => {
    const code = stripComments(readWizard());
    expect(code).toMatch(/switch \(guardCopy\.action\)/);
    expect(code).toMatch(/const exhaustive: never = guardCopy\.action;/);
  });
});

describe("issue #2333 S4c — the edit-screen city_required copy stops naming a field that is not there (T-19)", () => {
  test("the arm branches on the live event's format", () => {
    const code = stripComments(readEdit());
    const arm = code.match(
      /code\.includes\("city_required"\)([\s\S]{0,400}?)code\.includes\("party_types_required"\)/,
    );
    expect(arm).not.toBeNull();
    expect(arm![1]).toContain('liveEvent.format === "online"');
  });

  test("the online copy does NOT mention an address or the suggestions list", () => {
    const code = stripComments(readEdit());
    const arm = code.match(
      /code\.includes\("city_required"\)([\s\S]{0,400}?)code\.includes\("party_types_required"\)/,
    );
    const branch = arm![1];
    const onlineLine = branch
      .split("\n")
      .find((l) => l.includes("This online event can't be updated right now"));
    expect(onlineLine).toBeDefined();
    expect(onlineLine!.toLowerCase()).not.toContain("address");
    expect(onlineLine!.toLowerCase()).not.toContain("suggestions");
    expect(onlineLine!).toContain("city_required");
  });

  test("the in_person / hybrid copy is UNCHANGED — that host does have an address field", () => {
    const code = stripComments(readEdit());
    expect(code).toContain(
      "Pick the venue address from the suggestions so we have a city.",
    );
  });
});
