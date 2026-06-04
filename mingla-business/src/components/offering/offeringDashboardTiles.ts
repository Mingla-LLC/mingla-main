/**
 * offeringDashboardTiles — META-ORCH-1059 [experiences-business-parity] Pass 2.
 *
 * The per-kind DASHBOARD action-tile config. Pass 1 gave the shared list-card +
 * manage sheet a config "lens"; Pass 2 extends that lens to the dashboard tile
 * grid so the EVENT tile set (Scan · Scanners · Orders · Guests · Blasts ·
 * Public page · Brand page · Reconciliation) renders identically for trips and
 * experiences — each tile wired to that kind's real route + semantics.
 *
 * Architecture principle (same as Pass 1): NO hardcoded "event"/"attendee"
 * strings in shared code. Labels/nouns come from offeringKind.ts; route shapes
 * come from the builders below. The dashboards (`app/{kind}/[id]/index.tsx`)
 * iterate this list to render their grids.
 *
 * Routing note — the operator-confirmed "see through the right lens":
 *   - Orders / Guests / Scan / Scanners / Reconciliation reuse the EXISTING
 *     event sub-screens at `/event/{id}/...`. Those screens key off the event
 *     id and read orders by `event_id` (offering-agnostic), so experiences
 *     (which are events-rows) resolve directly. Trips resolve via the additive
 *     trip fallback in `useManagedEventRoute` (Pass 2).
 *   - Guests has a kind-specific override for TRIPS only: trips already ship a
 *     dedicated `/trip/{id}/travelers` route (the trip "Guests" lens), so the
 *     Guests tile points there for trips and at `/event/{id}/guests` otherwise.
 *   - Blasts / Group chat already route to `/event/{id}/...` for every kind
 *     (those screens don't depend on the resolved LiveEvent).
 */

import type { IconName } from "../ui/Icon";
import { offeringKindConfig, type OfferingKind } from "./offeringKind";

export type OfferingTileKey =
  | "scan"
  | "scanners"
  | "orders"
  | "guests"
  | "blasts"
  | "public"
  | "brand"
  | "reconciliation";

export interface OfferingTileDef {
  key: OfferingTileKey;
  icon: IconName;
  label: string;
  /** Whether this tile needs a published/public page (Public/Brand). */
  requiresPublicPage: boolean;
  /**
   * Build the in-app route for this tile. `id` is the offering id (events.id
   * for all 3 kinds). `brandSlug` is required only for the public/brand tiles.
   */
  route: (input: { id: string; brandSlug: string | null; slug: string }) => string;
  /** Optional secondary caption shown under the label. */
  sub?: string;
  /** Accessibility/aria label (defaults to `label`). */
  accessibilityLabel?: string;
}

/**
 * Build the ordered dashboard tile set for a kind. The order matches the
 * operator-confirmed set: Scan · Scanners · Orders · Guests · Blasts ·
 * Public page · Brand page · Reconciliation.
 */
export function buildOfferingDashboardTiles(
  kind: OfferingKind,
): OfferingTileDef[] {
  const cfg = offeringKindConfig(kind);
  const guestsLabel = `${cfg.metricPlural.charAt(0).toUpperCase()}${cfg.metricPlural.slice(1)}`;

  // Guests tile routing: trips have a dedicated travelers route; events +
  // experiences reuse the shared /event/{id}/guests screen.
  const guestsRoute =
    kind === "trip"
      ? ({ id }: { id: string }): string => `/trip/${id}/travelers`
      : ({ id }: { id: string }): string => `/event/${id}/guests`;

  return [
    {
      key: "scan",
      icon: "qr",
      label: "Scan tickets",
      requiresPublicPage: false,
      route: ({ id }) => `/event/${id}/scanner`,
      accessibilityLabel: "Scan tickets",
    },
    {
      key: "scanners",
      icon: "users",
      label: "Scanners",
      requiresPublicPage: false,
      route: ({ id }) => `/event/${id}/scanners`,
      accessibilityLabel: "Manage scanners",
    },
    {
      key: "orders",
      icon: "ticket",
      label: "Orders",
      requiresPublicPage: false,
      route: ({ id }) => `/event/${id}/orders`,
      accessibilityLabel: `${cfg.noun} orders`,
    },
    {
      key: "guests",
      icon: "user",
      label: guestsLabel,
      requiresPublicPage: false,
      route: guestsRoute,
      accessibilityLabel: guestsLabel,
    },
    {
      key: "blasts",
      icon: "send",
      label: "Blasts",
      requiresPublicPage: false,
      route: ({ id }) => `/event/${id}/blasts`,
      sub: "Message ticket buyers",
      accessibilityLabel: "Message ticket buyers",
    },
    {
      key: "public",
      icon: "eye",
      label: "Public page",
      requiresPublicPage: true,
      route: ({ brandSlug, slug }) => `${cfg.publicPathPrefix}/${brandSlug}/${slug}`,
      accessibilityLabel: `View public ${cfg.noun} page`,
    },
    {
      key: "brand",
      icon: "user",
      label: "Brand page",
      requiresPublicPage: true,
      route: ({ brandSlug }) => `/b/${brandSlug}`,
      accessibilityLabel: "View brand page",
    },
    {
      key: "reconciliation",
      icon: "receipt",
      label: "Reconciliation",
      requiresPublicPage: false,
      route: ({ id }) => `/event/${id}/reconciliation`,
      accessibilityLabel: "Reconciliation",
    },
  ];
}
