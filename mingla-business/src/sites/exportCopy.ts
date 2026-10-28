/*
 * #2829 A20 — the export carries every page, setting and collection entry as
 * files, and each photo and video as a signed link (the artifact bucket's
 * per-object limit is 20 MiB). Those links expire, so the app says so plainly
 * and tells the owner how to get fresh ones.
 */
export const EXPORT_MEDIA_LINKS_NOTE =
  "Your download has every page, setting and collection as files. Photos and videos are links that last 24 hours. Run Download everything again any time for fresh links.";
