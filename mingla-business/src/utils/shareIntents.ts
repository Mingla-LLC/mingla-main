/**
 * shareIntents — pure URL builders for platform-specific share intent links.
 *
 * No side effects. Each function returns a URL string suitable for
 * `Linking.openURL` (native) or `window.open` (web). Used by the kit
 * primitive `ShareModal` to deep-link into Twitter / WhatsApp / Email / SMS.
 *
 * Per Cycle 7 spec §2.7.
 */

const enc = (s: string): string => encodeURIComponent(s);

/**
 * Twitter / X compose intent.
 * Opens the compose dialog with the provided text + URL prefilled.
 */
export const twitterIntent = (url: string, title: string): string =>
  `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`;

/**
 * WhatsApp share intent. Universal `wa.me` link works on both web (opens
 * WhatsApp Web / Desktop) and native (opens WhatsApp app). Title and URL
 * are concatenated into the body since WhatsApp has no separate URL slot.
 */
export const whatsappIntent = (url: string, title: string): string =>
  `https://wa.me/?text=${enc(`${title} ${url}`)}`;

/**
 * Email mailto: intent. Body includes optional description on its own
 * line followed by the URL. Subject is the title.
 */
export const emailIntent = (
  url: string,
  title: string,
  description?: string,
): string => {
  const body =
    description !== undefined && description.trim().length > 0
      ? `${description}\n\n${url}`
      : url;
  return `mailto:?subject=${enc(title)}&body=${enc(body)}`;
};

/**
 * SMS sms: intent. Body is title + URL concatenated.
 *
 * Note: iOS uses `sms:&body=` with an ampersand; Android uses `sms:?body=`
 * with a question mark. Most platforms accept both shapes; using `?body=`
 * for consistency with the other intents.
 */
export const smsIntent = (url: string, title: string): string =>
  `sms:?body=${enc(`${title} ${url}`)}`;
