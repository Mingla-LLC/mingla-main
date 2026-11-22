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
 * drop the spread on card_viewed / card_saved / card_dismissed / card_expanded and
 * G-1 fails; remove the table sheet's call and G-2 fails.
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

  it('G-1 the four deck events send the W5 properties', () => {
    const src = read('../../SwipeableCards.tsx');
    expect(src).toContain('...deckCardVenueProps({ deckLead: currentRec.deckLead, claimedVenue: currentClaimedVenue }),');
    const saved = src.slice(src.indexOf('postHogService.capture("card_saved"'), src.indexOf('postHogService.capture("card_saved"') + 400);
    expect(saved).toContain('position_in_deck: swipePosition');
    expect(saved).toContain('...swipeLead');
    const dismissed = src.slice(src.indexOf('postHogService.capture("card_dismissed"'), src.indexOf('postHogService.capture("card_dismissed"') + 400);
    expect(dismissed).toContain('position_in_deck: swipePosition');
    expect(dismissed).toContain('...swipeLead');
    const expandedSites = src.split('postHogService.capture("card_expanded"').length - 1;
    expect(expandedSites).toBe(2);
    expect(src).toContain('position_in_deck: currentCardIndex,\n      ...expandLead,');
  });
  it('G-2 the table reservation sheet reports its checkout outcome', () => {
    const src = read('../../expandedCard/VenueReserveSheet.tsx');
    expect(src).toContain('captureVenueCheckoutFinished({ venueId, offerKind: "table_reservation", outcome: finished });');
  });
});
