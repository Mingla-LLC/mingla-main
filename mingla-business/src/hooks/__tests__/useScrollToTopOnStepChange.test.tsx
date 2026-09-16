/**
 * Wizard steps inherited the previous step's scroll offset.
 *
 * Found filming the RSVP tutorial on the iOS simulator: Step 5 "RSVP" scrolled
 * to the bottom → Continue → Step 6 opened already scrolled, the "Preview"
 * title clipped under the header. Every creator renders all of its steps in ONE
 * ScrollView, and nothing reset its offset when the step changed. The event,
 * trip, experience and venue creators had the same gap.
 *
 * Fails on revert: remove the hook call from any creator and the wiring test
 * names it; remove the scrollTo and the behaviour test fails.
 */
import React from "react";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

import {
  useScrollToTopOnStepChange,
  type ScrollableToTop,
} from "../useScrollToTopOnStepChange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = { update: (node: React.ReactElement) => void; unmount: () => void };
// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => Tree;
};

describe("useScrollToTopOnStepChange", () => {
  const setup = () => {
    const calls: unknown[] = [];
    const ref: { current: ScrollableToTop | null } = {
      current: { scrollTo: (options) => calls.push(options) },
    };
    const Wizard: React.FC<{ step: number; other?: string }> = ({ step }) => {
      useScrollToTopOnStepChange(ref, step);
      return null;
    };
    let tree: Tree | null = null;
    act(() => {
      tree = create(<Wizard step={4} />);
    });
    return { calls, ref, Wizard, tree: tree as unknown as Tree };
  };

  test("does not scroll on first mount (a resumed draft keeps its place)", () => {
    const { calls, tree } = setup();
    expect(calls).toEqual([]);
    act(() => tree.unmount());
  });

  test("Step 5 → Step 6 scrolls to the top, instantly", () => {
    const { calls, Wizard, tree } = setup();
    act(() => tree.update(<Wizard step={5} />));
    expect(calls).toEqual([{ x: 0, y: 0, animated: false }]);
    act(() => tree.update(<Wizard step={4} />)); // Back resets too
    expect(calls).toHaveLength(2);
    act(() => tree.unmount());
  });

  test("re-rendering within a step never moves the scroll", () => {
    const { calls, Wizard, tree } = setup();
    act(() => tree.update(<Wizard step={4} other="typed" />));
    act(() => tree.update(<Wizard step={4} other="typed more" />));
    expect(calls).toEqual([]);
    act(() => tree.unmount());
  });
});

describe("every creator wizard resets its scroll on step change", () => {
  const read = (rel: string): string =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  test.each([
    ["RSVP", "src/components/rsvp/RsvpCreatorWizard.tsx", "scrollViewRef", "currentStep"],
    ["Event (ticketed)", "src/components/event/EventCreatorWizard.tsx", "scrollViewRef", "currentStep"],
    ["Trip", "src/components/trip/TripCreatorWizard.tsx", "scrollViewRef", "step"],
    ["Experience", "src/components/experience/ExperienceCreatorWizard.tsx", "scrollRef", "step"],
    ["Venue", "src/components/venue/VenueCreatorWizard.tsx", "scrollRef", "stepId"],
  ])("%s creator", (_label, file, ref, step) => {
    const source = read(file);
    expect(source).toContain(`useScrollToTopOnStepChange(${ref}, ${step});`);
    // …and that ref is the one on the step ScrollView.
    expect(source).toMatch(new RegExp(`<ScrollView\\s+ref=\\{${ref}\\}`));
  });
});
