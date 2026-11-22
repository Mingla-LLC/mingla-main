/**
 * #4490 Explorer W5 — deck analytics for hosted venues (spec 06 W5 Analytics).
 *
 *   P-*  deckCardVenueProps / expandVenueProps: is_hosted_venue, deck_lead, venue_id;
 *   C-*  venue_checkout_finished: exact properties, no amounts / names / emails,
 *        the table sheet's outcomes;
 *   D-*  deckService carries the server's additive deckLead (and nothing else changes);
 *   G-*  wiring: the four deck events and the table sheet send the new properties.
 *
 * FAILS-ON-REVERT: drop deckLead from unifiedCardToRecommendation and D-1 fails;
 * drop the deck calls from SwipeableCards (or the spreads from deckCardAnalytics)
 * and G-1 fails; remove the table sheet's call and G-2 fails; drop the call in the
 * sheet's catch and G-3 fails (fix round 1, W6-N8).
 */
declare const jest: { mock(path: string, factory: () => unknown): void };
import fs from 'node:fs';
import path from 'node:path';

const captured: Array<{ event: string; props: Record<string, unknown> }> = [];
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: (event: string, props: Record<string, unknown>) => captured.push({ event, props }) },
}));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

import {
  captureVenueCheckoutFinished,
  deckCardVenueProps,
  expandVenueProps,
  tableCheckoutOutcome,
  venueCheckoutFinishedProps,
} from '../venueBookAnalytics';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('#4490 W5 deck analytics', () => {
  it('P-1 a hosted lead card is a hosted venue with its venue id', () => {
    expect(deckCardVenueProps({ deckLead: 'hosted_venue', claimedVenue: { venueId: 'v1', isBookable: true } })).toEqual({
      is_hosted_venue: true,
      deck_lead: 'hosted_venue',
      venue_id: 'v1',
    });
  });
  it('P-2 a bookable claimed venue the server did not lift is still hosted (flag off)', () => {
    expect(deckCardVenueProps({ claimedVenue: { venueId: 'v2', isBookable: true } })).toEqual({
      is_hosted_venue: true,
      deck_lead: null,
      venue_id: 'v2',
    });
  });
  it('P-3 a claimed venue with nothing to book, a plain place, an experience', () => {
    expect(deckCardVenueProps({ claimedVenue: { venueId: 'v3', isBookable: false } })).toEqual({
      is_hosted_venue: false,
      deck_lead: null,
      venue_id: 'v3',
    });
    expect(deckCardVenueProps({})).toEqual({ is_hosted_venue: false, deck_lead: null, venue_id: null });
    expect(deckCardVenueProps({ deckLead: 'experience', claimedVenue: null })).toEqual({
      is_hosted_venue: false,
      deck_lead: 'experience',
      venue_id: null,
    });
  });
  it('P-4 an unknown lead value is dropped, never forwarded', () => {
    expect(deckCardVenueProps({ deckLead: 'paid_boost' }).deck_lead).toBeNull();
  });
  it('P-5 card_saved / card_dismissed / card_expanded carry no venue_id', () => {
    expect(expandVenueProps(deckCardVenueProps({ deckLead: 'hosted_venue', claimedVenue: { venueId: 'v', isBookable: true } })))
      .toEqual({ is_hosted_venue: true, deck_lead: 'hosted_venue' });
  });

  it('C-1 venue_checkout_finished: exact keys, channel app, nothing personal', () => {
    captured.length = 0;
    captureVenueCheckoutFinished({ venueId: 'v1', offerKind: 'table_reservation', outcome: 'confirmed' });
    expect(captured).toEqual([
      { event: 'venue_checkout_finished', props: { venue_id: 'v1', offer_kind: 'table_reservation', outcome: 'confirmed', channel: 'app' } },
    ]);
    const keys = Object.keys(venueCheckoutFinishedProps({ venueId: 'v', offerKind: 'entry', outcome: 'failed' })).sort();
    expect(keys).toEqual(['channel', 'offer_kind', 'outcome', 'venue_id']);
  });
  it('C-2 the table sheet result maps to an outcome; a review step is not an end', () => {
    expect(tableCheckoutOutcome('succeeded')).toBe('confirmed');
    expect(tableCheckoutOutcome('canceled')).toBe('cancelled');
    expect(tableCheckoutOutcome('failed')).toBe('failed');
    expect(tableCheckoutOutcome('review')).toBeNull();
  });

  it('D-1 deckService carries deckLead only for the two known values', () => {
    const src = read('../../../services/deckService.ts');
    expect(src).toContain("...(card.deckLead === 'hosted_venue' ? { deckLead: 'hosted_venue' as const } : {}),");
    expect(src).toContain("...(card?.deckLead === 'experience' ? { deckLead: 'experience' as const } : {}),");
    // No client regrouping change (decision 1: the stricter solo lead is not built).
    expect(src).not.toMatch(/deckLead[^\n]*sort|sort[^\n]*deckLead/);
  });

  // TEST-MOD-APPROVED #4490 (W5 fix 2, W5-D1): this pin read the handlers' source
  // text and passed while the handlers threw at run time. The deck events are now
  // built by deckCard/deckCardAnalytics.ts, whose suite runs them
  // (issue_4490_w5_deck_handlers); this pin checks SwipeableCards calls them.
  it('G-1 the four deck events send the W5 properties', () => {
    const src = read('../../SwipeableCards.tsx');
    expect(src).toContain('trackDeckCardViewed({');
    expect(src.split('trackDeckCardExpanded({').length - 1).toBe(2);
    expect(src).toContain('trackDeckCardSwiped({');
    expect(src).toContain('positionInDeck: currentRec?.id === card.id ? currentCardIndex : null,');
    const lib = read('../../deckCard/deckCardAnalytics.ts');
    for (const event of ['"card_viewed"', '"card_expanded"', '"card_saved"', '"card_dismissed"']) {
      expect(lib).toContain(`postHogService.capture(${event}`);
    }
    expect(lib).toContain('...deckCardVenueProps({ deckLead: input.card.deckLead, claimedVenue: input.claimedVenue }),');
    expect(lib.split('...lead,').length - 1).toBe(6);
  });
  it('G-2 the table reservation sheet reports its checkout outcome', () => {
    const src = read('../../expandedCard/VenueReserveSheet.tsx');
    expect(src).toContain('captureVenueCheckoutFinished({ venueId, offerKind: "table_reservation", outcome: finished });');
  });
  it('G-3 a reservation that throws still reports outcome failed (fix round 1, W6-N8)', () => {
    const src = read('../../expandedCard/VenueReserveSheet.tsx');
    const catchBlock = src.slice(src.indexOf('} catch (caught) {'), src.indexOf('onReservationFailed?.("create_failed");\n    }\n  };'));
    expect(catchBlock).toContain('captureVenueCheckoutFinished({ venueId, offerKind: "table_reservation", outcome: "failed" });');
  });
});
