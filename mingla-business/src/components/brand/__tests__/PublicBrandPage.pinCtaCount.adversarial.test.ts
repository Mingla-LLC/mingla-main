/**
 * ORCH-0963 T-08 ADVERSARIAL — Sticky "Buy tickets" pill count = 3 (first 3
 * upcoming-event cards only); 0 on past tab; 0 on trip-brand body.
 *
 * Attacks a DIFFERENT angle than T-03/T-04/T-05/T-06: the count threshold
 * could regress to `pinCta={true}` (all cards), `pinCta={index < 1}` (only
 * first), or could leak to PastEventsTab. T-08 pins exactly 3, on upcoming
 * only, on event-brand only.
 *
 * Fails-on-revert: changing `pinCta={index < PINNED_CTA_CARD_COUNT}` to
 * `pinCta={true}` FAILs T-08a (constant pinned to 3) + T-08b (mapping uses
 * index comparison).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-08 ADVERSARIAL — Pin-CTA count + scope", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  test("T-08a PINNED_CTA_CARD_COUNT constant equals 3", () => {
    expect(pageSrc).toMatch(/const\s+PINNED_CTA_CARD_COUNT\s*=\s*3;/);
  });

  test("T-08b UpcomingEventsTab maps with pinCta={index < PINNED_CTA_CARD_COUNT}", () => {
    const upcomingBody = pageSrc.match(
      /const\s+UpcomingEventsTab:\s*React\.FC<UpcomingEventsTabProps>[\s\S]*?\n\};/,
    );
    expect(upcomingBody).not.toBeNull();
    expect(upcomingBody![0]).toMatch(
      /events\.map\(\(e,\s*index\)\s*=>\s*\(\s*[\s\S]*?<EventMiniCard[\s\S]*?pinCta=\{index\s*<\s*PINNED_CTA_CARD_COUNT\}/,
    );
  });

  test("T-08c PastEventsTab does NOT pass pinCta", () => {
    const pastBody = pageSrc.match(
      /const\s+PastEventsTab:\s*React\.FC<PastEventsTabProps>[\s\S]*?\n\};/,
    );
    expect(pastBody).not.toBeNull();
    expect(pastBody![0]).not.toMatch(/pinCta/);
  });

  test("T-08d EventMiniCard guards rendering on `pinCta && !past`", () => {
    const cardBody = pageSrc.match(
      /const\s+EventMiniCard:\s*React\.FC<EventMiniCardProps>[\s\S]*?\n\};/,
    );
    expect(cardBody).not.toBeNull();
    expect(cardBody![0]).toMatch(/pinCta\s*&&\s*!past\s*\?/);
  });

  test("T-08e Trip-brand tab bodies do NOT pass pinCta — they render TripMiniCard, never EventMiniCard", () => {
    const tripsTabBody = pageSrc.match(
      /const\s+UpcomingTripsTab:[\s\S]*?\n\};/,
    );
    expect(tripsTabBody).not.toBeNull();
    expect(tripsTabBody![0]).not.toMatch(/pinCta/);
    expect(tripsTabBody![0]).not.toMatch(/<EventMiniCard/);
  });

  test("T-08f pin pill is hidden from accessibility tree (decorative — full card is the hit target)", () => {
    // Per I-38 + SPEC §3.4: pill MUST NOT add a secondary 44pt touch target.
    // We add the pill as a non-interactive View with accessibility-hidden.
    const cardBody = pageSrc.match(
      /const\s+EventMiniCard:\s*React\.FC<EventMiniCardProps>[\s\S]*?\n\};/,
    );
    expect(cardBody).not.toBeNull();
    expect(cardBody![0]).toMatch(/accessibilityElementsHidden/);
  });
});
