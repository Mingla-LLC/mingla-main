// #4548 Retest 1 R1 — no owner drops a typed, unsaved guest pack on exit.
//
// Behaviour: the gate's `useGuestPackPending` re-renders the owner the moment
// the working copy changes, so each owner's existing leave guard (discard
// confirm, web reload prompt) sees a pack-only change.
// Source contract per owner (the wizards cannot be mounted under the default
// config; the live editor's runtime exit is proven by the tester's
// issue_4548_live_edit_pack_exit GP-EXIT-1):
//   EditPublishedScreen — the close / Android back / reload guard counts the pack.
//   ExperienceCreatorWizard — step-1 close and reload count the pack.
//   EventCreatorWizard, RsvpCreatorWizard — create-mode close asks (not pristine);
//     draft-edit close saves the pack first and stays on failure; reload asks.
//
// FAILS-ON-REVERT: dropping the pack from any guard turns its case red.
jest.mock("../../services/guestPackService", () => ({
  fetchEventGuestPack: jest.fn(async () => null),
  saveEventGuestPack: jest.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import React from "react";
// react-test-renderer ships no types here; typed the same way as the #1780 suite.
interface Rendered {
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Rendered;
  act: (callback: () => void) => void;
};
const { act } = TestRenderer;

import { useGuestPackPending } from "../guestPackGate";
import {
  ensureGuestPackLoaded,
  resetAllGuestPackSessions,
  setGuestPackNote,
} from "../guestPackSession";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "../../..", rel), "utf8");

const EVENT = "22222222-2222-4222-8222-222222222222";

// The renderer needs React's act environment flag (as the other render suites set).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.spyOn(console, "error").mockImplementation(() => undefined);

describe("useGuestPackPending", () => {
  test("turns true on a typed pack change and false once cleared", async () => {
    resetAllGuestPackSessions();
    await ensureGuestPackLoaded(EVENT);
    const seen: boolean[] = [];
    const Probe = (): null => {
      seen.push(useGuestPackPending(EVENT));
      return null;
    };
    let renderer: Rendered | undefined;
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    expect(seen.at(-1)).toBe(false);
    act(() => setGuestPackNote(EVENT, "Gate code 4548"));
    expect(seen.at(-1)).toBe(true);
    act(() => setGuestPackNote(EVENT, ""));
    expect(seen.at(-1)).toBe(false);
    act(() => setGuestPackNote(EVENT, "again"));
    act(() => resetAllGuestPackSessions());
    expect(seen.at(-1)).toBe(false);
    act(() => renderer?.unmount());
  });

  test("no event id means nothing pending", () => {
    const seen: boolean[] = [];
    const Probe = (): null => {
      seen.push(useGuestPackPending(null));
      return null;
    };
    let renderer: Rendered | undefined;
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === false)).toBe(true);
    act(() => renderer?.unmount());
  });
});

describe("every owner counts a pack-only change on exit", () => {
  test("EditPublishedScreen: close, Android back and reload ask first", () => {
    const src = read("src/components/event/EditPublishedScreen.tsx");
    expect(src).toContain("const guestPackPending = useGuestPackPending(guestPackId);");
    expect(src).toMatch(/dirty: editedSinceSeed \|\| guestPackPending,/);
    expect(src).toContain("useUnsavedChangesGuard({ dirty: hasUnsavedEdits, onRequestLeave: handleBack });");
  });

  test("ExperienceCreatorWizard: step-1 close and reload ask first", () => {
    const src = read("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(src).toContain("const guestPackPending = useGuestPackPending(experienceId);");
    expect(src).toMatch(/payloadKey !== payloadBaselineRef\.current\) \|\|\s*guestPackPending,/);
    expect(src).toContain("hasUnsavedEditsRef.current = hasUnsavedEdits;");
  });

  test.each([
    ["src/components/event/EventCreatorWizard.tsx"],
    ["src/components/rsvp/RsvpCreatorWizard.tsx"],
  ])("%s: create asks, draft edit saves first, reload asks", (file) => {
    const src = read(file);
    expect(src).toContain(
      "if (isDraftPristine() && !hasPendingGuestPack(guestPackSessionId)) {",
    );
    expect(src).toMatch(
      /\} else if \(hasPendingGuestPack\(guestPackSessionId\)\) \{[\s\S]{0,400}void flushGuestPack\(guestPackSessionId\)\.then\(\(result\) => \{\s*if \(result\.ok\) onExit\("abandoned"\);\s*else handleShowToast\(result\.message\);/,
    );
    expect(src).toContain("const guestPackPending = useGuestPackPending(guestPackSessionId);");
    expect(src).toContain(
      "useUnsavedChangesGuard({ dirty: guestPackPending, onRequestLeave: handleClose });",
    );
    // Android back routes to the same close owner.
    expect(src).toMatch(/useWizardHardwareBack\(\{[\s\S]{0,300}onExit: handleClose,/);
  });
});
