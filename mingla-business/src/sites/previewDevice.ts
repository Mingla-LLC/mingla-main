/**
 * #2829 W9r (DESIGN_SPEC §1.7, SPEC §37 A21) — the draft preview at any size.
 * Desktop / Tablet / Phone with portrait or landscape, rendered at the real
 * CSS width (so the site's own breakpoints apply) and scaled to fit. The
 * choice is remembered per signed-in user (server preference
 * `website.previewDevice`, local cache for the first paint).
 */

export type PreviewDevice = "desktop" | "tablet" | "phone";
export type PreviewOrientation = "portrait" | "landscape";

/** What is stored: the device, and the orientation remembered per device. */
export type PreviewDevicePreference = {
  device: PreviewDevice;
  tablet: PreviewOrientation;
  phone: PreviewOrientation;
};

export const PREVIEW_DEVICE_KEY = "website.previewDevice";
export const PREVIEW_DEVICES: readonly PreviewDevice[] = ["desktop", "tablet", "phone"];
export const PREVIEW_DEVICE_LABELS: Readonly<Record<PreviewDevice, string>> = {
  desktop: "Desktop",
  tablet: "Tablet",
  phone: "Phone",
};

/** Desktop on desktop web; Phone on phones and tablets (§1.7). */
export function defaultPreviewPreference(isWideDesktop: boolean): PreviewDevicePreference {
  return { device: isWideDesktop ? "desktop" : "phone", tablet: "portrait", phone: "portrait" };
}

/** A stored value → a preference, or null when it isn't one (never trusted blindly). */
export function parsePreviewPreference(value: unknown): PreviewDevicePreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!PREVIEW_DEVICES.includes(record.device as PreviewDevice)) return null;
  const orientation = (raw: unknown): PreviewOrientation => (raw === "landscape" ? "landscape" : "portrait");
  return { device: record.device as PreviewDevice, tablet: orientation(record.tablet), phone: orientation(record.phone) };
}

export function orientationOf(preference: PreviewDevicePreference): PreviewOrientation | null {
  return preference.device === "desktop" ? null : preference[preference.device];
}

/** The simulated viewport in CSS px: Desktop 1440×900, Tablet 820×1180, Phone 390×844 (swapped in landscape). */
export function previewDimensions(preference: PreviewDevicePreference): { width: number; height: number } {
  if (preference.device === "desktop") return { width: 1440, height: 900 };
  const [width, height] = preference.device === "tablet" ? [820, 1180] : [390, 844];
  return preference[preference.device] === "landscape" ? { width: height, height: width } : { width, height };
}

/** "820 × 1180 · portrait" (Desktop has no orientation). */
export function previewSizeReadout(preference: PreviewDevicePreference): string {
  const { width, height } = previewDimensions(preference);
  const orientation = orientationOf(preference);
  return orientation ? `${width} × ${height} · ${orientation}` : `${width} × ${height}`;
}

/** Device-ish corner radius before scaling: 10 / 28 / 44. */
export function previewCornerRadius(device: PreviewDevice): number {
  return device === "desktop" ? 10 : device === "tablet" ? 28 : 44;
}

/** scale = min(paneWidth / W, maxHeight / H, 1), never negative. */
export function previewScale(input: { paneWidth: number; maxHeight: number; width: number; height: number }): number {
  if (input.paneWidth <= 0 || input.maxHeight <= 0) return 0;
  return Math.min(input.paneWidth / input.width, input.maxHeight / input.height, 1);
}

export function withDevice(preference: PreviewDevicePreference, device: PreviewDevice): PreviewDevicePreference {
  return { ...preference, device };
}

/** Rotate swaps the current device's orientation (no-op on Desktop). */
export function rotated(preference: PreviewDevicePreference): PreviewDevicePreference {
  if (preference.device === "desktop") return preference;
  const key = preference.device;
  return { ...preference, [key]: preference[key] === "portrait" ? "landscape" : "portrait" };
}

/** Business-web full-screen preview address at the chosen size. */
export function fullScreenPreviewPath(brandId: string, preference: PreviewDevicePreference): string {
  const orientation = orientationOf(preference);
  return `/brand/${brandId}/website/preview?device=${preference.device}${orientation ? `&orientation=${orientation}` : ""}`;
}

/** The full-screen route's query → a preference over the remembered one. */
export function preferenceFromQuery(
  base: PreviewDevicePreference,
  query: { device?: string | null; orientation?: string | null },
): PreviewDevicePreference {
  if (!PREVIEW_DEVICES.includes(query.device as PreviewDevice)) return base;
  const device = query.device as PreviewDevice;
  if (device === "desktop") return { ...base, device };
  const orientation: PreviewOrientation = query.orientation === "landscape" ? "landscape" : "portrait";
  return { ...base, device, [device]: orientation };
}
