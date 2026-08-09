const { createHash, timingSafeEqual } = require("node:crypto");

const SHARED_CARD_PROXY_HEADER = "x-mingla-shared-card-proxy";

const digest = (value) => createHash("sha256").update(value).digest();

const firstHeaderValue = (req) => {
  const raw = req?.headers?.[SHARED_CARD_PROXY_HEADER];
  return Array.isArray(raw) ? raw[0] : raw;
};

const hasValidSharedCardProxySecret = (req) => {
  const expected = process.env.SHARED_CARD_PROXY_SECRET;
  const provided = firstHeaderValue(req);
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  return timingSafeEqual(digest(provided), digest(expected));
};

module.exports = {
  SHARED_CARD_PROXY_HEADER,
  hasValidSharedCardProxySecret,
};
