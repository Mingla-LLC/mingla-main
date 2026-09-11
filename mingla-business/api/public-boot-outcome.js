// #3214 — first-party relay for the public-page boot outcome.
//
// Public Host pages (/b/, /e/, /t/, /exp/, /b/…/v/…) are a server document that
// hands off to the Expo app. When that handoff fails nothing of the app is
// running, so the app's own PostHog client cannot report it. This relay is the
// same shape as the content-share analytics relay the server-rendered share
// pages already use: the browser sends a small beacon ONLY after an explicit
// analytics grant (checked client-side, exactly as the app reads it), and the
// PostHog project key never leaves the server. Same vendor, same US host.

const ALLOWED_ORIGINS = new Set(["https://host.usemingla.com"]);
const EVENT_NAME = "public_page_boot_outcome";
const REASONS = {
  success: new Set(["mounted", "late_mount"]),
  failure: new Set([
    "bootstrap_unsupported",
    "bootstrap_http",
    "bootstrap_empty",
    "bootstrap_scripts_missing",
    "bootstrap_network",
    "chunk_load_error",
    "chunk_execution_error",
    "chunk_rejection",
    "mount_timeout",
    "app_unmounted",
  ]),
};
const BODY_KEYS = ["outcome", "reason", "elapsed_ms", "path", "load_id"];
const MAX_BODY_BYTES = 1024;
const MAX_ELAPSED_MS = 10 * 60 * 1000;
const SEGMENT = "[a-z0-9][a-z0-9_-]{0,127}";
const PAGE_TYPES = [
  ["venue", new RegExp(`^/b/${SEGMENT}/v/${SEGMENT}$`)],
  ["brand", new RegExp(`^/b/${SEGMENT}$`)],
  ["event", new RegExp(`^/e/${SEGMENT}/${SEGMENT}$`)],
  ["trip", new RegExp(`^/t/${SEGMENT}/${SEGMENT}$`)],
  ["experience", new RegExp(`^/exp/${SEGMENT}/${SEGMENT}$`)],
];

const pageTypeFor = (path) => {
  if (typeof path !== "string") return null;
  const match = PAGE_TYPES.find(([, pattern]) => pattern.test(path));
  return match ? match[0] : null;
};

// sendBeacon posts text/plain, which Vercel exposes as a string; tolerate an
// already-parsed object, a Buffer, and an unread stream as well.
const readBody = async (req) => {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = "";
  if (typeof req.body === "string") raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
  else {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw new Error("too_large");
    }
  }
  if (raw.length > MAX_BODY_BYTES) throw new Error("too_large");
  return JSON.parse(raw || "null");
};

const validOutcome = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !BODY_KEYS.includes(key))) return null;
  const reasons = REASONS[body.outcome];
  if (!reasons || !reasons.has(body.reason)) return null;
  if (!Number.isSafeInteger(body.elapsed_ms) || body.elapsed_ms < 0 || body.elapsed_ms > MAX_ELAPSED_MS) return null;
  if (typeof body.load_id !== "string" || !/^[0-9a-z]{8,32}$/.test(body.load_id)) return null;
  const pageType = pageTypeFor(body.path);
  if (!pageType) return null;
  return { ...body, page_type: pageType };
};

const createPublicBootOutcomeHandler = (send = fetch) => async (req, res) => {
  res.setHeader("cache-control", "private, no-store, max-age=0");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("allow", "POST");
    return res.end();
  }
  const origin = String(req.headers?.origin || "");
  if (!ALLOWED_ORIGINS.has(origin)) {
    res.statusCode = 404;
    return res.end();
  }
  let outcome;
  try {
    outcome = validOutcome(await readBody(req));
  } catch {
    outcome = null;
  }
  if (!outcome) {
    res.statusCode = 400;
    return res.end();
  }
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY || "";
  if (!/^phc_[A-Za-z0-9_-]+$/.test(key)) {
    console.warn("[public-boot-outcome] EXPO_PUBLIC_POSTHOG_KEY is missing or malformed; outcome not forwarded");
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      await send("https://us.i.posthog.com/capture/", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          event: EVENT_NAME,
          properties: {
            distinct_id: `public-boot:${outcome.load_id}`,
            $process_person_profile: false,
            outcome: outcome.outcome,
            reason: outcome.reason,
            elapsed_ms: outcome.elapsed_ms,
            page_type: outcome.page_type,
            path: outcome.path,
          },
        }),
      });
    } catch (error) {
      console.warn("[public-boot-outcome] PostHog capture failed", error instanceof Error ? error.message : error);
    } finally {
      clearTimeout(timeout);
    }
  }
  res.statusCode = 204;
  return res.end();
};

module.exports = createPublicBootOutcomeHandler();
module.exports.createPublicBootOutcomeHandler = createPublicBootOutcomeHandler;
module.exports.EVENT_NAME = EVENT_NAME;
module.exports.REASONS = REASONS;
