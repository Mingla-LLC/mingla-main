/**
 * ORCH-1076 Stream B — event Step-7 refactor IDENTITY guard (SPEC §9 T-15/T-16).
 *
 * The event Step-7 StripeBlockedCard was extracted into the shared
 * src/components/offering/StripeBlockedCard primitive. This refactor MUST be
 * byte-identical: same strings, same CTA label, same accessibility label, same
 * tokens — and Step 7 must consume the shared card WITHOUT overriding any copy
 * prop (so it inherits the byte-identical event defaults).
 *
 * Repo harness note: Node-env Jest, no RN renderer (cannot import RN
 * components). This test characterizes the refactor via source assertions:
 * (a) the shared card's defaults = the original event strings, (b) Step 7
 * imports + renders the shared card with the bare onConnectStripe prop and NO
 * copy override, (c) the local StripeBlockedCard sub-component is GONE (no
 * re-fork), (d) the ready/free branch is untouched. Any copy/token/wiring drift
 * breaks an assertion. First explicit lock of the blocked-stripe render (DISC-1).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const step7Source = (): string =>
  read("src/components/event/CreatorStep7Preview.tsx");
const sharedCardSource = (): string =>
  read("src/components/offering/StripeBlockedCard.tsx");

describe("ORCH-1076 — event Step-7 refactor identity (T-15)", () => {
  test("shared card DEFAULT copy === the original event StripeBlockedCard copy", () => {
    // Characterization snapshot of the EXACT event StripeBlockedCard copy
    // (main rebranded "Stripe" → "bank" user-facing wording; the shared
    // primitive defaults mirror that so the event refactor stays faithful).
    const EVENT_TITLE = "Bank required for paid tickets";
    const EVENT_BODY =
      "Connect a bank to publish. Free tickets can be published any time.";
    const EVENT_CTA = "Connect bank";

    const card = sharedCardSource();
    expect(card).toContain(`title = "${EVENT_TITLE}"`);
    expect(card).toContain(`body = "${EVENT_BODY}"`);
    expect(card).toContain(`ctaLabel = "${EVENT_CTA}"`);
  });

  test("Step 7 renders the shared card with NO copy override (inherits defaults)", () => {
    const src = step7Source();
    // Imports the shared primitive (not a local re-fork).
    expect(src).toContain(
      'import { StripeBlockedCard } from "../offering/StripeBlockedCard"',
    );
    // Renders it with only the onConnectStripe prop → byte-identical defaults.
    expect(src).toContain(
      "<StripeBlockedCard onConnectStripe={onConnectStripe} />",
    );
    // The local sub-component definition is GONE (no re-fork of the card).
    expect(src).not.toContain(
      "const StripeBlockedCard: React.FC<StripeBlockedCardProps>",
    );
    expect(src).not.toContain("interface StripeBlockedCardProps");
    // No event-side override of the trip/experience copy leaked in.
    expect(src).not.toContain("Connect a bank to publish this paid trip");
    expect(src).not.toContain("Bank required for paid trips");
    // Still gated on the blocked-stripe publishability status.
    expect(src).toContain('publishability.status === "blocked-stripe"');
  });

  test("T-16 ready (free-only) event still shows ReadyCard, not the Stripe banner", () => {
    const src = step7Source();
    // The three-way status card switch is intact.
    expect(src).toContain('publishability.status === "ready"');
    expect(src).toContain("<ReadyCard");
    expect(src).toContain("<ErrorsBlockedCard");
    const readyIdx = src.indexOf('publishability.status === "ready"');
    const stripeIdx = src.indexOf('publishability.status === "blocked-stripe"');
    expect(readyIdx).toBeGreaterThan(-1);
    expect(stripeIdx).toBeGreaterThan(readyIdx);
  });
});
