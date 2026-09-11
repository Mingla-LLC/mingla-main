/**
 * #3187 — share analytics for a canonical public page opened from a share.
 *
 * A share now points at the page itself (`/b/…`, `/e/…`, `/t/…`, `/exp/…`,
 * `/b/…/v/…`) with `?ms=<code>.<version>`, instead of the `/s/` interstitial.
 * This module ports the two interstitial events that have an analogue on the
 * page, with the exact payload the endpoint accepts:
 *
 *   share_public_page_viewed   on load
 *   share_destination_action   on a click of the page's `[data-share-destination]` CTA,
 *                              and — after the Host web app takes the page over and
 *                              replaces that CTA — from the app's own controls, via
 *                              `window.__minglaShareDestination(action)` (#3187 P2-1)
 *
 * `share_install_cta_opened` is deliberately absent: the page has no install
 * CTA and must not grow one (accepted in the #3187 SPEC, F-11).
 *
 * TRANSPORT. Same-origin `fetch` with `keepalive` and `content-type:
 * application/json`, posting the exact body the `/s/` page posts. That is the
 * request shape the endpoint receives in production today (the marketing proxy
 * re-posts every interstitial beacon to it as JSON). A `sendBeacon` from this
 * page would arrive as `text/plain`, a body shape that endpoint has never
 * served. `keepalive` keeps the destination event alive across the CTA's own
 * navigation, which is what `sendBeacon` was for on `/s/`.
 *
 * CONSENT. Identical gate to `/s/`: nothing is sent unless
 * `localStorage.mingla_consent_v1` records `granted`. Note that storage is
 * per-origin, so this reads `host.usemingla.com`'s consent record (the Host
 * web app writes the same key), not `usemingla.com`'s.
 *
 * Kept in its own module on purpose: the page's share/copy runtime lives in
 * `publicSearchBrowserRuntime.js`, whose semantic-gate exemption forbids the
 * `kind`/code tokens this payload needs.
 */

const { SHARE_ATTRIBUTION_PARAM, parseShareAttributionValue } = require("../../packages/sharing");

const ANALYTICS_KINDS = new Set(["event", "rsvp_event", "trip", "experience", "venue", "brand"]);
const CODE_RE = /^[0-9A-Za-z]{16}$/;

/**
 * The share attribution a page request carries (`?ms=<code>.<version>`), or
 * null. Read straight off the request URL: `ms` is deliberately NOT one of the
 * renderer's ATTRIBUTION_KEYS, so it is never forwarded into CTA hrefs.
 * Malformed or absent -> null -> the page renders exactly as without it.
 */
const shareAttributionFromRequestUrl = (requestUrl, origin) => {
  try {
    const parsed = new URL(typeof requestUrl === "string" && requestUrl ? requestUrl : "/", origin);
    return parseShareAttributionValue(parsed.searchParams.get(SHARE_ATTRIBUTION_PARAM));
  } catch {
    return null;
  }
};

/** `ms=<code>.<version>` for a valid attribution, so it can ride a 308 to a renamed page. */
const shareAttributionQueryParam = (attribution) =>
  `${SHARE_ATTRIBUTION_PARAM}=${attribution.code}.${attribution.version}`;

const scriptJson = (value) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

/**
 * Every `action` the relay accepts (`api/content-share-analytics.js` ACTIONS).
 * Pinned against the real handler by the #3187 suite, so the two cannot drift.
 */
const SHARE_DESTINATION_ACTIONS = Object.freeze([
  "buy_tickets", "rsvp", "book_trip", "book_experience",
  "view_event", "view_rsvp_event", "view_trip", "view_experience", "view_venue", "view_brand",
  "directions", "website", "call", "view_offering",
]);

/**
 * #3187 P2-1 — the global the booted Host web app records destination actions
 * through. The server CTA is inside `#root`, so the app replaces it (and its
 * listener) when it takes the page over; the app's own controls then report the
 * same intent here, and the server CTA and the app share ONE recorder: one
 * consent gate, one payload shape, one relay, one de-duplication ledger.
 */
const SHARE_DESTINATION_GLOBAL = "__minglaShareDestination";
const SHARE_DESTINATION_LEDGER_KEY = "mingla_share_destination_v1";

/**
 * The inline analytics script for one attributed page view, or "" when any
 * input is invalid — a malformed or absent attribution renders no script and
 * leaves the page otherwise identical.
 *
 * DE-DUPLICATION RULE. At most ONE `share_destination_action` per
 * (share code, version, action) per browser tab. The first tap wins, whether it
 * is the server CTA before the app boots or the app's own control after it
 * does, so the count means "recipients of this share who took this action", not
 * taps. The ledger is in memory and in `sessionStorage`, so a tap on the server
 * RSVP anchor (which stays on the page) followed by the app's RSVP after
 * takeover, or a return to the page in the same tab, is still one intent. A tap
 * without consent records nothing and marks nothing, so granting consent later
 * does not lose the next tap. `share_public_page_viewed` is not de-duplicated.
 *
 * PAGE SCOPE. The app may navigate client-side to another page without a new
 * document; the recorder only accepts calls while the tab is still on the path
 * this attribution was issued for.
 */
const shareAnalyticsScript = (attribution) => {
  if (attribution === null || typeof attribution !== "object") return "";
  const { code, version, kind } = attribution;
  if (typeof code !== "string" || !CODE_RE.test(code)) return "";
  if (!Number.isSafeInteger(version) || version < 1) return "";
  if (!ANALYTICS_KINDS.has(kind)) return "";
  const base = scriptJson({ code, version, kind });
  const actions = scriptJson(SHARE_DESTINATION_ACTIONS);
  return `<script>(()=>{const base=${base};`
    + `const actions=new Set(${actions});`
    + `const trimPath=(value)=>String(value||'/').replace(/\\/+$/,'')||'/';`
    + `const issuedPath=trimPath(location.pathname);`
    + `const done=new Set();`
    + `try{const stored=JSON.parse(sessionStorage.getItem('${SHARE_DESTINATION_LEDGER_KEY}')||'[]');if(Array.isArray(stored))stored.forEach((entry)=>{if(typeof entry==='string')done.add(entry)})}catch{}`
    + `const consented=()=>{try{const consent=JSON.parse(localStorage.getItem('mingla_consent_v1')||'null');return consent?.choice==='granted'||consent?.value==='granted'}catch{return false}};`
    + `const send=(payload)=>{try{fetch('/api/content-share-analytics',{method:'POST',keepalive:true,credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{})}catch{}};`
    + `const record=(event,action)=>{try{if(!consented())return false;const payload={event,code:base.code,version:base.version,kind:base.kind};`
    + `if(event==='share_destination_action'){if(!actions.has(action)||trimPath(location.pathname)!==issuedPath)return false;`
    + `const entry=base.code+'.'+base.version+':'+action;if(done.has(entry))return false;done.add(entry);`
    + `try{sessionStorage.setItem('${SHARE_DESTINATION_LEDGER_KEY}',JSON.stringify(Array.from(done)))}catch{}payload.action=action}`
    + `send(payload);return true}catch{return false}};`
    + `try{Object.defineProperty(window,'${SHARE_DESTINATION_GLOBAL}',{value:(action)=>record('share_destination_action',action),configurable:true,writable:false})}catch{}`
    + `record('share_public_page_viewed');`
    + `document.querySelectorAll('[data-share-destination]').forEach((node)=>node.addEventListener('click',()=>record('share_destination_action',node.dataset.shareDestination)))`
    + `})()</script>`;
};

/**
 * The `share_destination_action` value for the page's single CTA, or null when
 * the page has no CTA. Every value is a member of the endpoint's ACTIONS set.
 * Keyed on the same discriminants `actionForFacts` uses to choose the CTA.
 */
const shareDestinationActionFor = (facts) => {
  if (!facts || typeof facts !== "object") return null;
  if (facts.kind === "event") return facts.eventType === "rsvp" ? "rsvp" : "buy_tickets";
  if (facts.kind === "trip") return "book_trip";
  if (facts.kind === "experience") return "book_experience";
  return null;
};

/** The analytics `kind` for a resolved public page. `/e/` splits on eventType. */
const shareAnalyticsKindFor = (facts) => {
  if (!facts || typeof facts !== "object") return null;
  if (facts.kind === "event") return facts.eventType === "rsvp" ? "rsvp_event" : "event";
  return ["trip", "experience", "venue", "brand"].includes(facts.kind) ? facts.kind : null;
};

module.exports = {
  SHARE_DESTINATION_ACTIONS,
  SHARE_DESTINATION_GLOBAL,
  SHARE_DESTINATION_LEDGER_KEY,
  shareAnalyticsKindFor,
  shareAnalyticsScript,
  shareAttributionFromRequestUrl,
  shareAttributionQueryParam,
  shareDestinationActionFor,
};
