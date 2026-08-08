const { createHmac } = require("node:crypto");

const PUBLIC_KINDS = new Set(["event", "rsvp_event", "trip", "experience", "venue", "brand"]);
const IDENTITY_KEYS = {
  event: ["brandSlug", "eventSlug"], rsvp_event: ["brandSlug", "eventSlug"],
  trip: ["brandSlug", "eventSlug"], experience: ["brandSlug", "eventSlug"],
  venue: ["brandSlug", "venueSlug"], brand: ["brandSlug"],
};

const exactIdentity = (kind, identity) => {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const expected = IDENTITY_KEYS[kind];
  if (!expected || Object.keys(identity).sort().join("|") !== [...expected].sort().join("|")) return false;
  return expected.every((key) => typeof identity[key] === "string" && identity[key].trim() === identity[key]
    && identity[key].length > 0 && identity[key].length <= 256);
};

const validatePublicCreateBody = (body) => Boolean(body && typeof body === "object" && !Array.isArray(body)
  && body.contract === "content_share_v1" && PUBLIC_KINDS.has(body.kind) && exactIdentity(body.kind, body.identity));

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const callerAddress = (req) => {
  const vercel = req?.headers?.["x-vercel-forwarded-for"];
  const first = (Array.isArray(vercel) ? vercel[0] : vercel || "").split(",")[0].trim();
  return first || req?.socket?.remoteAddress || "unknown";
};

const actorToken = (req, secret) => createHmac("sha256", secret).update(`public-create:${callerAddress(req)}`).digest("hex");

const createPublicContentShareHandler = (fetchImpl = globalThis.fetch) => async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
  if (!validatePublicCreateBody(req.body)) return sendJson(res, 400, { error: "validation" });
  const baseUrl = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
  const proxySecret = process.env.SHARED_CARD_PROXY_SECRET || "";
  if (!baseUrl || !anonKey || !proxySecret) return sendJson(res, 503, { error: "not_available" });
  try {
    const upstream = await fetchImpl(`${baseUrl}/functions/v1/shared-card`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${anonKey}`, "x-mingla-shared-card-proxy": proxySecret, "x-mingla-public-share-actor": actorToken(req, proxySecret) },
      body: JSON.stringify(req.body),
    });
    const payload = await upstream.json().catch(() => ({ error: "server" }));
    return sendJson(res, upstream.status, payload);
  } catch { return sendJson(res, 503, { error: "not_available" }); }
};

module.exports = { createPublicContentShareHandler, validatePublicCreateBody };
