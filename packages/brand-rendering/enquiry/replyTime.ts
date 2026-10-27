/**
 * #4111 — the Message card's "Usually replies within …" line, from
 * `brand_enquiry_public_profile.reply_minutes`. PURE and separate from the
 * topic builder so the brand page foot stays tiny.
 */
/** "Usually replies within …" — null hides the line. */
export const replyTimeLabel = (minutes: number | null | undefined): string | null => {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes <= 60) return "Usually replies within an hour";
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Usually replies within ${hours} hours`;
  const days = Math.ceil(hours / 24);
  return days <= 1 ? "Usually replies within a day" : `Usually replies within ${days} days`;
};
