/**
 * Where / When steps — the copy says what actually happens.
 *
 * 1. The RSVP wizard reuses CreatorStep3Where, which spoke tickets on every
 *    RSVP: "Hide address until ticket purchase", "revealed to ticketed guests",
 *    "until the guest checks out". An RSVP has no tickets and no checkout.
 * 2. The Where info card ignored the toggle. With "Hide address" OFF the
 *    subtitle said "Address visible on the public event page." while the card
 *    under it still said the address stays off the public page.
 * 3. The When step promised "We'll show this to guests in their local time."
 *    Every guest surface prints times in the EVENT's zone (public page,
 *    Explorer app, emails, tickets, RSVP passes); nothing converts to the
 *    viewer's zone.
 *
 * Behavioural on the pure copy (every state), plus source wiring so the
 * component cannot drift back to hard-coded ticket strings.
 *
 * FAILS-ON-REVERT: hard-code the old strings back into CreatorStep3Where → W-3;
 * drop the toggle branch from the info card → W-2; restore the When helper → T-1.
 */

import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import { whereStepAddressCopy } from "../whereStepCopy";

const ROOT = path.resolve(__dirname, "../../../..");
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (rel: string): string =>
  strip(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const TICKET_WORDS = /ticket|checks? out|purchase/i;

describe("Where step address copy", () => {
  test("W-1 ticketed copy is unchanged when the address is hidden", () => {
    expect(whereStepAddressCopy(false, true)).toEqual({
      toggleTitle: "Hide address until ticket purchase",
      toggleSubtitle: "Address only revealed to ticketed guests.",
      infoCard:
        "Address appears in tickets and confirmation emails — not on the public page until the guest checks out.",
      onlineLinkHint:
        "Link is shared with ticketed guests only — never posted publicly.",
    });
    expect(whereStepAddressCopy(false, false).toggleSubtitle).toBe(
      "Address visible on the public event page.",
    );
  });

  test("W-2 the info card follows the toggle and never contradicts the subtitle", () => {
    for (const isRsvp of [false, true]) {
      const hidden = whereStepAddressCopy(isRsvp, true);
      const shown = whereStepAddressCopy(isRsvp, false);
      expect({ isRsvp, card: hidden.infoCard }).toEqual({
        isRsvp,
        card: expect.stringContaining("not on the public page"),
      });
      expect({ isRsvp, card: shown.infoCard }).toEqual({
        isRsvp,
        card: expect.stringContaining("shows on the public event page"),
      });
      expect(shown.infoCard).not.toContain("not on the public page");
      expect(shown.toggleSubtitle).toBe("Address visible on the public event page.");
    }
  });

  test("W-3 RSVP copy speaks RSVP in every state, never tickets or checkout", () => {
    const hidden = whereStepAddressCopy(true, true);
    expect(hidden).toEqual({
      toggleTitle: "Hide address until guests RSVP",
      toggleSubtitle: "Address only revealed to guests who RSVP.",
      infoCard:
        "Address appears in RSVP confirmations — not on the public page until the guest RSVPs.",
      onlineLinkHint:
        "Link is shared with guests who RSVP only — never posted publicly.",
    });
    for (const hide of [true, false]) {
      for (const line of Object.values(whereStepAddressCopy(true, hide))) {
        expect({ hide, line, ticketWording: TICKET_WORDS.test(line) }).toEqual({
          hide,
          line,
          ticketWording: false,
        });
      }
    }
  });

  test("W-4 CreatorStep3Where renders the copy for the draft's kind and toggle", () => {
    const src = read("src/components/event/CreatorStep3Where.tsx");
    expect(src).toContain("whereStepAddressCopy(");
    expect(src).toContain("draft.isRsvp === true");
    expect(src).toContain("draft.hideAddressUntilTicket,");
    for (const slot of [
      "accessibilityLabel={addressCopy.toggleTitle}",
      "{addressCopy.toggleTitle}",
      "{addressCopy.toggleSubtitle}",
      "{addressCopy.infoCard}",
      "{addressCopy.onlineLinkHint}",
    ]) {
      expect(src).toContain(slot);
    }
    // No hard-coded ticket wording left behind in the component.
    for (const old of [
      "Hide address until ticket purchase",
      "Address only revealed to ticketed guests.",
      "until the guest checks out",
      "Link is shared with ticketed guests only",
    ]) {
      expect({ old, present: src.includes(old) }).toEqual({ old, present: false });
    }
  });

  test("W-5 an address saved without its pin opens editable, not as a selected address over an empty map", () => {
    const src = read("src/components/event/CreatorStep3Where.tsx");
    expect(src).toMatch(
      /draft\.address\?\.trim\(\) && draft\.city && draft\.locationGeo\s*\?\s*"selected"\s*:\s*"editing"/,
    );
  });
});

describe("When step time zone copy", () => {
  test("T-1 it no longer promises guests their local time", () => {
    const src = read("src/components/event/CreatorStep2When.tsx");
    expect(src).not.toMatch(/their local time/i);
    expect(src).toContain("Guests see times in this time zone.");
  });
});
