// #3872 — the hire terms the host ticks before paying (approved P-hire).
export function hireTerms(
  name: string,
  usageDays: number | null | undefined,
): string[] {
  return [
    "Script approved by you before filming; then locked",
    "After approval, fixes are for sound and picture only (2 rounds)",
    "Post stays up 30 days, labelled as a paid partnership",
    `You may reuse the video for ${usageDays === 365 ? "1 year" : `${usageDays ?? 90} days`}`,
    `Mingla holds the money and pays ${name} after the posts are verified`,
  ];
}
