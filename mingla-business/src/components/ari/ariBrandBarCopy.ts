/**
 * #4389 (screen AB) — host copy for Ari's top bar and brand switch.
 * [TRANSITIONAL] English only — exit: moved into the locale files with the
 * rest of the #4389 copy (i18n remainder in the build log).
 */
export const ARI_BRAND_BAR_COPY = {
  switcherTitle: "Talk to Ari about",
  chats: "Chats",
  settings: "Ari settings",
  busyTitle: "Ari is still answering",
  busyBody: (next: string, current: string): string =>
    `Switch to ${next} anyway? The answer will finish in ${current}'s chat.`,
  busySwitch: (next: string): string => `Switch to ${next}`,
  busyStay: (current: string): string => `Stay on ${current}`,
  switched: (next: string): string => `Now talking about ${next}.`,
  draftKept: (other: string): string => `Your unsent message for ${other} is saved there.`,
} as const;
