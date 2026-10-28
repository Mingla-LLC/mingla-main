import { FEATURE_ICON_VIEWBOX, FEATURE_ICONS, isFeatureIconName } from "../../contracts/generated/icons.ts";

/*
 * #2829 W7 — a built-in feature icon (site-contracts icons.ts), drawn inline
 * in the colour around it. Owners pick a name from the closed list; they
 * never upload a drawing.
 */
export function FeatureIcon({ name, size = 26 }: { name: unknown; size?: number }) {
  if (!isFeatureIconName(name)) return null;
  return (
    <svg width={size} height={size} viewBox={FEATURE_ICON_VIEWBOX} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={FEATURE_ICONS[name]} />
    </svg>
  );
}
