// #3872 — the hire terms the host ticks before paying (approved P-hire).
export function hireTerms(
  name: string,
  _usageDays: number | null | undefined,
): string[] {
  return [
    "Script approved by you before filming; then locked",
    "After approval, fixes are for sound and picture only (2 rounds)",
    "Post stays up 30 days, labelled as a paid partnership",
    "After the full Creator fee is released, you and Mingla may reuse, edit and advertise with the approved video worldwide, forever, without another usage fee",
    "Ads run directly from the Creator's social account still need the separate permission required by that platform",
    `Mingla holds the money and pays ${name} after the posts are verified`,
  ];
}
