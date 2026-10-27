export type Check = "pass" | "fail" | "unknown";
export type PostEvidence = {
  platform: string;
  url: string;
  expectedHandle: string;
  observedHandle?: string | null;
  caption?: string | null;
  mustTags: string[];
  postedAt?: string | null;
  shootAt: string;
};
const URLS: Record<string, RegExp> = {
  instagram: /^https:\/\/(www\.)?instagram\.com\/(reel|p)\//i,
  tiktok: /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\//i,
  youtube: /^https:\/\/(www\.)?youtube\.com\/shorts\//i,
  x: /^https:\/\/(www\.)?x\.com\/[^/]+\/status\//i,
};
export function verifyGigPost(input: PostEvidence) {
  const url: Check = URLS[input.platform]?.test(input.url) ? "pass" : "fail";
  const author: Check = input.observedHandle == null
    ? "unknown"
    : input.observedHandle.replace(/^@/, "").toLowerCase() ===
        input.expectedHandle.replace(/^@/, "").toLowerCase()
    ? "pass"
    : "fail";
  const captionLower = input.caption?.toLowerCase();
  const tags: Check = captionLower == null
    ? "unknown"
    : input.mustTags.every((tag) => captionLower.includes(tag.toLowerCase())) &&
        (captionLower.includes("#ad") ||
          captionLower.includes("paid partnership"))
    ? "pass"
    : "fail";
  const date: Check = input.postedAt == null
    ? "unknown"
    : new Date(input.postedAt) >= new Date(input.shootAt)
    ? "pass"
    : "fail";
  const checks = { url, author, tags, date };
  const values = Object.values(checks);
  const result: Check = values.includes("fail")
    ? "fail"
    : values.includes("unknown")
    ? "unknown"
    : "pass";
  return { result, checks };
}
