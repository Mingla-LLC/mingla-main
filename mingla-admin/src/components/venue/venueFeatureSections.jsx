// #4490 — the read-only "Features", "Spaces" and "Offers" sections of the Admin
// venue detail. Rows come from `../../lib/venueFeaturesAdmin.js` (pure).
import { Badge } from "../ui/Badge";
import {
  buildFeatureRows,
  buildOfferRows,
  buildPlanRows,
  buildSpaceRows,
  countFeaturesOn,
} from "../../lib/venueFeaturesAdmin";

function field(label, value, render) {
  return { label, value, render };
}
const muted = (v) => <span className="text-[var(--color-text-muted)]">{v}</span>;

const STATE_BADGE = {
  on_live: { variant: "success", label: "On" },
  on_waiting: { variant: "warning", label: "On, not live for guests yet" },
  off: { variant: "default", label: "Off" },
};

/**
 * `features` is the `admin_venue_features` payload, or null when the read
 * failed (a visible, non-blocking message, never a blank section).
 */
export function buildVenueFeatureSections(features) {
  if (features == null) {
    return [
      {
        label: "Features",
        fields: [field("", "Features could not load. Reload the page to try again.", (x) => muted(x))],
      },
    ];
  }
  const featureRows = buildFeatureRows(features);
  const spaceRows = buildSpaceRows(features);
  const offerRows = buildOfferRows(features);
  const planRows = buildPlanRows(features);

  return [
    {
      label: `Features (${countFeaturesOn(featureRows)} on)`,
      fields:
        featureRows.length === 0
          ? [field("", "This venue has no features yet.", (x) => muted(x))]
          : featureRows.map((row) =>
              field(row.label, row, (r) => {
                const badge = STATE_BADGE[r.state];
                return (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={badge.variant} dot>{badge.label}</Badge>
                    {r.state !== "off" && r.scope !== null && (
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        Only in {r.scope.length > 0 ? r.scope.join(", ") : "no space"}
                      </span>
                    )}
                    {r.state === "on_waiting" && r.waitingOn.length > 0 && (
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        Waiting on {r.waitingOn.join(", ")}
                      </span>
                    )}
                  </span>
                );
              }),
            ),
    },
    {
      label: `Spaces (${spaceRows.length})`,
      fields:
        spaceRows.length === 0
          ? [field("", "No spaces yet.", (x) => muted(x))]
          : spaceRows.map((s) =>
              field(s.name, s, (sp) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{sp.setting}</Badge>
                  {sp.capacity !== null && <span className="text-sm">{sp.capacity}</span>}
                </span>
              )),
            ),
    },
    {
      label: `Offers (${offerRows.length})`,
      fields:
        offerRows.length === 0
          ? [field("", "No offers on sale.", (x) => muted(x))]
          : offerRows.map((o) =>
              field(o.name, o, (of) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{of.kind}</Badge>
                  <span className="text-sm">from {of.from}</span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">{of.mode}</span>
                  <Badge variant="success" dot>{of.status}</Badge>
                </span>
              )),
            ),
    },
    ...(planRows.length > 0
      ? [
          {
            label: `Membership plans (${planRows.length})`,
            fields: planRows.map((p) =>
              field(p.name, p, (pl) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm">{pl.price}</span>
                  <Badge variant={pl.status === "Full" ? "warning" : "success"} dot>{pl.status}</Badge>
                </span>
              )),
            ),
          },
        ]
      : []),
  ];
}
