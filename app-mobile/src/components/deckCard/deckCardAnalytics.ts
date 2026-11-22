/**
 * #4490 W5 fix 2 (W5-D1) — the deck card's analytics, in one place, behind one
 * guard.
 *
 * W5 added venue fields to the deck's `card_viewed`, `card_expanded`,
 * `card_saved` and `card_dismissed` events inside SwipeableCards' handlers. One
 * of the helpers was never imported, so building the properties threw a
 * ReferenceError on every card: Details and card taps opened nothing, a right
 * swipe never reached the save, and the shared deck stalled after one swipe.
 *
 * Two rules follow:
 *   1. Analytics never breaks a user action. Every deck analytics call runs
 *      through `runDeckAnalytics`, which catches and logs (the same promise the
 *      analytics services make: postHogService.capture swallows client errors,
 *      "analytics never breaks the UI"). Property building is inside the guard.
 *   2. The handlers call these functions, which tests can call directly (the
 *      deck component itself cannot be mounted in a test: native-only deps).
 *
 * Event names and properties are exactly what the handlers sent before.
 */
import { logAppsFlyerEvent } from "../../services/appsFlyerService";
import { mixpanelService } from "../../services/mixpanelService";
import { postHogService } from "../../services/postHogService";
import { deckCardVenueProps, expandVenueProps } from "../venueOffers/venueBookAnalytics";

/** Runs one analytics step; an exception is logged and swallowed, never rethrown. */
export function runDeckAnalytics(site: string, track: () => void): void {
  try {
    track();
  } catch (error) {
    console.warn(`[SwipeableCards] analytics failed at ${site}; the action continues`, error);
  }
}

export interface DeckAnalyticsCard {
  id: string;
  title: string;
  category: string;
  deckLead?: "hosted_venue" | "experience" | null;
  estimatedCostPerPerson?: number | null;
}

export interface DeckAnalyticsClaimedVenue {
  venueId: string;
  isBookable: boolean;
}

/** `card_viewed` (Mixpanel and PostHog). */
export function trackDeckCardViewed(input: {
  card: DeckAnalyticsCard;
  claimedVenue: DeckAnalyticsClaimedVenue | null;
  positionInDeck: number;
  isCurated: boolean;
}): void {
  runDeckAnalytics("card_viewed", () => {
    const view = {
      card_id: input.card.id,
      card_title: input.card.title,
      category: input.card.category,
      position_in_deck: input.positionInDeck,
      is_curated: input.isCurated,
      // #4490 Explorer W5: is_hosted_venue, deck_lead, venue_id (null for non-venues).
      ...deckCardVenueProps({ deckLead: input.card.deckLead, claimedVenue: input.claimedVenue }),
    };
    mixpanelService.trackCardViewed(view);
    // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
    postHogService.capture("card_viewed", view);
  });
}

/**
 * `card_expanded`. A claimed venue opens its venue page and sends the PostHog
 * event only (with `destination: "venue_page"`), as before; any other card
 * sends Mixpanel and PostHog.
 */
export function trackDeckCardExpanded(input: {
  card: DeckAnalyticsCard;
  claimedVenue: DeckAnalyticsClaimedVenue | null;
  positionInDeck: number;
}): void {
  runDeckAnalytics("card_expanded", () => {
    // #4490 Explorer W5: position_in_deck, is_hosted_venue, deck_lead.
    const lead = expandVenueProps(
      deckCardVenueProps({ deckLead: input.card.deckLead, claimedVenue: input.claimedVenue }),
    );
    if (input.claimedVenue !== null) {
      postHogService.capture("card_expanded", {
        card_id: input.card.id,
        card_title: input.card.title,
        category: input.card.category,
        source: "home",
        destination: "venue_page",
        position_in_deck: input.positionInDeck,
        ...lead,
      });
      return;
    }
    mixpanelService.trackCardExpanded({
      cardId: input.card.id,
      cardTitle: input.card.title,
      category: input.card.category,
      source: "home",
      positionInDeck: input.positionInDeck,
      isHostedVenue: lead.is_hosted_venue,
      deckLead: lead.deck_lead,
    });
    // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
    postHogService.capture("card_expanded", {
      card_id: input.card.id,
      card_title: input.card.title,
      category: input.card.category,
      source: "home",
      position_in_deck: input.positionInDeck,
      ...lead,
    });
  });
}

/** AppsFlyer `af_content_view` when a pool card's sheet opens. */
export function trackDeckCardContentView(card: DeckAnalyticsCard & { rating?: number | null }): void {
  runDeckAnalytics("af_content_view", () => {
    logAppsFlyerEvent("af_content_view", {
      af_content_type: card.category,
      af_content_id: card.id,
      af_price: card.estimatedCostPerPerson || 0,
      source: "home",
      rating: card.rating || 0,
    });
  });
}

/** `card_saved` (right) or `card_dismissed` (left): AppsFlyer, Mixpanel and PostHog. */
export function trackDeckCardSwiped(input: {
  direction: "left" | "right";
  card: DeckAnalyticsCard;
  claimedVenue: DeckAnalyticsClaimedVenue | null;
  /** The card's deck position when it was the top card, else null. */
  positionInDeck: number | null;
  isCurated: boolean;
}): void {
  runDeckAnalytics(input.direction === "right" ? "card_saved" : "card_dismissed", () => {
    const { card, isCurated } = input;
    // #4490 Explorer W5: position_in_deck, is_hosted_venue, deck_lead.
    const lead = expandVenueProps(
      deckCardVenueProps({ deckLead: card.deckLead, claimedVenue: input.claimedVenue }),
    );
    if (input.direction === "right") {
      logAppsFlyerEvent("af_add_to_wishlist", {
        af_content_type: card.category,
        af_price: card.estimatedCostPerPerson || 0,
        af_content_id: card.id,
      });
      mixpanelService.trackCardSaved({
        card_id: card.id,
        card_title: card.title,
        category: card.category,
        is_curated: isCurated,
        source: "swipe",
        position_in_deck: input.positionInDeck ?? undefined,
        ...lead,
      });
      // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
      postHogService.capture("card_saved", {
        card_id: card.id,
        card_title: card.title,
        category: card.category,
        is_curated: isCurated,
        source: "swipe",
        position_in_deck: input.positionInDeck,
        ...lead,
      });
      return;
    }
    logAppsFlyerEvent("card_dismissed", {
      af_content_type: card.category,
    });
    mixpanelService.trackCardDismissed({
      card_id: card.id,
      card_title: card.title,
      category: card.category,
      is_curated: isCurated,
      position_in_deck: input.positionInDeck ?? undefined,
      ...lead,
    });
    // META-ORCH-1187 — behavior event (mirror of the Mixpanel site above).
    postHogService.capture("card_dismissed", {
      card_id: card.id,
      card_title: card.title,
      category: card.category,
      is_curated: isCurated,
      position_in_deck: input.positionInDeck,
      ...lead,
    });
  });
}
