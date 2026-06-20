// galleryLayout — ORCH-1138 A2.
//
// Pure count→layout selector for CountAwareGallery, extracted into its OWN
// RN-free module so it is unit-testable without mounting React Native (mirrors
// how @mingla/offering-rendering keeps offeringCta pure). empty → "none" (renders
// zero nodes, rule 9), 1 → "one", 2 → "two", 3+ → "slider".

export type GalleryLayout = "none" | "one" | "two" | "slider";

export const pickGalleryLayout = (count: number): GalleryLayout => {
  if (count <= 0) return "none";
  if (count === 1) return "one";
  if (count === 2) return "two";
  return "slider";
};
