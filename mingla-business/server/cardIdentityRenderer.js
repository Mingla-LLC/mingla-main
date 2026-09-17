const React = require("react");
const fs = require("node:fs");
const {
  RAMP,
  PLATE,
  SLIVER,
  SURFACES,
  surfaceScrimHeight,
  surfacePlateUnder,
  surfacePlateBoundary,
  surfaceSliverBoundary,
  selectSharedCardFacts,
} = require("@mingla/card-identity");
const { isPublicShareMediaUrl, selectPreviewFacts, statusLabel } = require("../../packages/sharing");
const { fieldFor, stampContent } = require("./fallbackShareCard");

const cssGradient = (ramp) => `linear-gradient(180deg,${ramp.colors.map((color, index) => `${color} ${Math.round(ramp.locations[index] * 100)}%`).join(",")})`;

const safeText = (value) => typeof value === "string" ? value.trim() : "";
/**
 * #2589 — the fallback card is the last thing standing between a share and a
 * bare URL, so its composition must be total. Anything that can throw upstream
 * (a facts blob that fails `parseShareFactsV1`, a malformed date) degrades to
 * the documented empty result instead of failing the image. Surfaced to logs,
 * never swallowed silently.
 */
const degradeTo = (fallback, label, run) => {
  try { return run(); } catch (error) {
    console.warn(`issue-2589 share card degraded (${label}):`, error?.message || error);
    return fallback;
  }
};
/**
 * The stamp took these facts, so the plate re-selects WITHOUT them and the freed
 * slot fills with the next available fact — nothing appears twice. Keys only:
 * this card reads no `venue`, `area` or `destination`, which is what makes a
 * gated offering and an ungated one render identical geometry (#2489 / #2587).
 */
const factsWithoutStamped = (facts, stamp) => {
  if (!stamp || !Array.isArray(stamp.consumedKeys) || !stamp.consumedKeys.length) return facts;
  const remaining = { ...facts };
  for (const key of stamp.consumedKeys) delete remaining[key];
  return remaining;
};
/**
 * #2700 — the plate's detail row is measured and cut HERE, before the shaper
 * sees it.
 *
 * Both plates clip that row at two 16pt lines with `overflow: hidden`, and the
 * cut lands wherever satori happens to break. When it landed just after a
 * separator the separator became the last visible glyph, and the card shipped a
 * dangling middot: "Aug 29, 2026 at 1:00 PM · Didi Museum · Akin Adesola
 * Street 175, Lagos 10, Lagos, Nigeria ·" — which reads as a rendering fault
 * rather than as truncation.
 *
 * CSS cannot fix it in this engine. `-webkit-line-clamp` and
 * `text-overflow: ellipsis` are INERT here: five clamp variants
 * (`display: block`, `-webkit-box`, `flex`, the `lineClamp` shorthand and
 * `white-space: nowrap`) rendered BYTE-IDENTICAL PNGs through @vercel/og 0.11.1
 * / satori 0.25.0, and `font-variant-numeric` is inert the same way. Measured
 * against the real rasteriser, not read off a support table.
 *
 * The row is therefore composed, not clipped:
 *
 * 1. The joined string is measured against the row's real capacity and whole
 *    trailing facts are dropped until it fits, so the shaper is never handed a
 *    string it will have to cut.
 * 2. Whatever survives is stripped of trailing whitespace and separators before
 *    a single ellipsis is appended — so the composed row cannot END on a
 *    separator for ANY input, and a truncated row reads as "there is more"
 *    rather than as a fault.
 *
 * A no-break space after the separator would additionally make a dangling
 * separator impossible at the SHAPER, not just in the string, by carrying
 * "· fact" down to the next line as one unit — and it renders byte-identically,
 * since a no-break space and a space have the same advance in Inter. It is
 * deliberately NOT taken here: it changes the composed string and would
 * invalidate the ten plate strings pinned by A4 in
 * `scripts/issue-2589/fallback-share-card.tester.adversarial.test.mjs`, which
 * this issue was not dispatched to supersede. Raised for #2700 instead.
 *
 * Both plates call this, so they cannot diverge.
 */
const FACT_SEPARATOR = " \u00B7 ";
const ELLIPSIS = "\u2026";
/** The plate's own side padding (`padding: 9px 12px 7px`) and the row's clip. */
const PLATE_SIDE_PADDING = 12;
const FACT_LINE_HEIGHT = 16;
const FACT_CLIP_HEIGHT = 32;
/**
 * Per-character advance in ems, calibrated against THIS renderer rather than
 * guessed: each class carries its WIDEST measured member, found by
 * binary-searching the character count at which satori wraps a 288pt line at
 * 13pt.
 * Measured maxima — W .963 · M/m .886 · @ and em-dash .923 · O/N .764 ·
 * euro .738 · digits .671 ("0") · lowercase .599 (b/d/g/k/p/q/x) · en-dash
 * .599 · slash .482 · hyphen .426 · r/t/f .396 · "1" .389 · l/I .270 ·
 * i .246 · space .269 · . , middot .201 · ellipsis .583. An entry may carry a
 * third pattern the character must ALSO match, which is how the Latin classes
 * are kept from swallowing other scripts.
 */
const FACT_ADVANCE_EM = Object.freeze([
  [/[MWmw%@\u2014\u00C6\u00E6\u0152\u0153]/u, 0.98],
  [/[ilIjftr1()\[\]|!'\u2019]/u, 0.42],
  // Latin ONLY. A Cyrillic or Greek capital is `\p{Lu}` too and runs far wider
  // than .78, so every other script falls through to the unknown-glyph charge
  // rather than being under-charged as if it were an "O".
  [/\p{Lu}/u, 0.78, /\p{Script=Latin}/u],
  [/\p{Ll}/u, 0.61, /\p{Script=Latin}/u],
  [/\p{Nd}/u, 0.69],
  [/[ \t\u00A0]/u, 0.28],
  [/[.,;:\u00B7\u2022]/u, 0.22],
  // The ellipsis this function appends is charged at its MEASURED advance. It
  // was briefly left to the unknown-glyph charge, which over-priced it by .72em
  // and dropped a whole fact that fitted — the estimate must be honest about the
  // one glyph the algorithm itself adds.
  [/\u2026/u, 0.60],
  [/[\u20AC&$\u00A3+\u2013]/u, 0.76],
  [/[\-\/\\#]/u, 0.50],
]);
/**
 * Anything unmatched — CJK, the naira sign, an emoji, a script this table has no
 * business guessing at. Charged wider than the widest measured Latin glyph
 * (.963) and wider than a full-width ideograph, so an unknown codepoint can only
 * ever make the estimate too big.
 */
const UNKNOWN_ADVANCE_EM = 1.3;
/**
 * Every class above carries its widest member, so a real mixed-case string
 * measures systematically wide. Across 14 strings binary-searched against
 * satori for their true single-line width the raw estimate ran 1.099x-1.175x
 * high (mean 1.125). Dividing the budget by the LOW end of that band keeps the
 * estimate on the safe side of every measured string — worst case 1.008x — while
 * removing most of the bias, so a row that really fits is not truncated for
 * nothing. Verified: over 48 strings the corrected model never under-counts a
 * line, and matches satori exactly on all 29 realistic ones.
 */
const FACT_WIDTH_CALIBRATION = 1.09;
const advanceEm = (character) => {
  for (const [pattern, em, script] of FACT_ADVANCE_EM) {
    if (!pattern.test(character)) continue;
    if (script && !script.test(character)) continue;
    return em;
  }
  return UNKNOWN_ADVANCE_EM;
};
const wordEm = (word) => { let em = 0; for (const character of word) em += advanceEm(character); return em; };
/**
 * Greedy word wrap, exactly as the shaper does it: the ONLY break opportunity is
 * an ordinary space. A no-break space is charged a space's width and is
 * deliberately not a split point, because satori does not break there either
 * (measured).
 */
const wrappedLineCount = (value, usableEm) => {
  const words = value.split(" ").filter(Boolean);
  if (!words.length) return 0;
  const spaceEm = advanceEm(" ");
  let lines = 1;
  let cursor = 0;
  for (const word of words) {
    const width = wordEm(word);
    const next = cursor === 0 ? width : cursor + spaceEm + width;
    if (next <= usableEm) { cursor = next; continue; }
    lines += 1;
    cursor = width;
    // `wordBreak: break-word` splits a word wider than the row across lines.
    while (cursor > usableEm) { lines += 1; cursor -= usableEm; }
  }
  return lines;
};
/** Nothing the shaper could leave dangling survives to the end of the row. */
const withoutDanglingSeparator = (value) => value.replace(/[\s\u00B7]+$/u, "");
/**
 * Compose the detail row for a plate `plateW` points wide whose text sets at
 * `size` points. Facts are the unit of meaning, so a fact is the unit dropped;
 * only a single fact too wide for the whole row is ever cut inside, and only at
 * a word boundary unless one word alone overflows.
 */
function factsLine(tokens, plateW, size) {
  const parts = (Array.isArray(tokens) ? tokens : [])
    .map((token) => withoutDanglingSeparator(safeText(token))).filter(Boolean);
  if (!parts.length) return "";
  const usableEm = ((plateW - 2 * PLATE_SIDE_PADDING) / size) * FACT_WIDTH_CALIBRATION;
  const rows = Math.max(1, Math.floor(FACT_CLIP_HEIGHT / FACT_LINE_HEIGHT));
  const fits = (value) => wrappedLineCount(value, usableEm) <= rows;
  const joined = parts.join(FACT_SEPARATOR);
  if (fits(joined)) return joined;
  for (let count = parts.length - 1; count >= 1; count -= 1) {
    const candidate = withoutDanglingSeparator(parts.slice(0, count).join(FACT_SEPARATOR)) + ELLIPSIS;
    if (fits(candidate)) return candidate;
  }
  const words = parts[0].split(" ").filter(Boolean);
  for (let count = words.length - 1; count >= 1; count -= 1) {
    const candidate = withoutDanglingSeparator(words.slice(0, count).join(" ")) + ELLIPSIS;
    if (fits(candidate)) return candidate;
  }
  const head = Array.from(words[0] || "");
  while (head.length > 1 && !fits(head.join("") + ELLIPSIS)) head.pop();
  return withoutDanglingSeparator(head.join("")) + ELLIPSIS;
}
/** 20pt of air between the stamp's bottom edge and a worst-case 2-line title. */
const STAMP_TITLE_CLEARANCE = 20;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_RENDERED_PNG_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT_SHARE_JPEG_BYTES = 200_000;
const CONTENT_SHARE_JPEG_QUALITIES = Object.freeze([82, 78, 74, 70, 66]);
/**
 * #2589 — GIF is an accepted cover content type.
 *
 * It was absent, so a GIF cover was rejected on content type even once its host
 * was allowed: the two gates had to BOTH be wrong for the symptom to look like
 * "Giphy covers do nothing", and both were. sharp decodes page 0 of an animated
 * GIF, so what gets composed is the STILL FIRST FRAME — which is correct and
 * expected: no social platform animates an og:image. Video is deliberately still
 * absent; it has no path through this renderer and must not acquire one here.
 */
const PUBLIC_IMAGE_MIME = /^image\/(?:avif|gif|jpeg|png|webp)(?:;|$)/i;
/**
 * #2589 — was a third hand-copy of the share host allowlist and had already
 * drifted from the other two (it rejected `videos.pexels.com`, which the edge
 * can persist — so the edge could store a poster this renderer would then refuse
 * and emit no og:image at all). It now delegates to the one CommonJS owner in
 * `packages/sharing`. Do not restate the list here again.
 *
 * The env-var Bunny host is threaded through rather than read inside the shared
 * predicate: `packages/sharing` is also bundled into two React Native apps and
 * must not read `process.env` at module scope.
 */
const isAllowedPublicPoster = (value) => {
  const bunnyHost = safeText(process.env.BUNNY_STREAM_CDN_HOSTNAME).toLowerCase();
  return isPublicShareMediaUrl(value, bunnyHost ? [bunnyHost] : []);
};
async function prepareCoverForOg(cover, fetchImpl = fetch, sharpImpl) {
  const source = safeText(cover);
  if (/^data:image\/(?:png|jpeg);base64,/i.test(source)) return source;
  if (!isAllowedPublicPoster(source)) throw new Error("cover_unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(source, { redirect: "error", signal: controller.signal });
    const declaredSize = Number(response.headers.get("content-length") || "0");
    if (!response.ok || !PUBLIC_IMAGE_MIME.test(response.headers.get("content-type") || "")
      || declaredSize > MAX_COVER_BYTES) throw new Error("cover_unavailable");
    const input = Buffer.from(await response.arrayBuffer());
    if (input.length === 0 || input.length > MAX_COVER_BYTES) throw new Error("cover_unavailable");
    const sharp = sharpImpl || require("sharp");
    const png = await sharp(input, { limitInputPixels: 20_000_000, failOn: "error" })
      .rotate().resize({ width: 1200, height: 1350, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 }).toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } finally {
    clearTimeout(timeout);
  }
}
const factsFor = (snapshot) => {
  const m = snapshot && snapshot.metadata && typeof snapshot.metadata === "object" ? snapshot.metadata : {};
  return selectSharedCardFacts(m);
};

/** The sole S4/S5 visual substrate. Geometry and boundaries come from the
 * measured package descriptors; this file owns composition, never copied tokens. */
function cardIdentityElement(snapshot, surfaceKey, scale = 1) {
  const s = SURFACES[surfaceKey];
  if (!s || !["s4Snippet", "s5Og"].includes(surfaceKey)) throw new Error("unsupported share surface");
  const px = (value) => value * scale;
  const boundary = surfacePlateBoundary(surfaceKey);
  const sliverBoundary = surfaceSliverBoundary(surfaceKey);
  const facts = factsFor(snapshot);
  const titleBottom = px(s.bottomInset + s.plateH + s.gap);
  const scrimH = px(surfaceScrimHeight(surfaceKey));
  const cover = safeText(snapshot.cover_url);
  if (!cover) throw new Error("cover_required");
  return React.createElement("div", { style: {
    width: px(s.w), height: px(s.h), display: "flex", position: "relative", overflow: "hidden",
    borderRadius: px(s.cardR), color: "white", fontFamily: "Inter, Arial, sans-serif", background: "#171717",
  } },
  React.createElement("img", { src: cover, style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } }),
  React.createElement("div", { style: { position: "absolute", left: 0, right: 0, bottom: 0, height: scrimH, background: cssGradient(RAMP.bottom) } }),
  React.createElement("div", { style:{position:"absolute",left:px(24),top:px(24),width:px(124),height:px(44),display:"flex",alignItems:"center",justifyContent:"center",borderRadius:px(18),background:"#FFF7EF",border:`${px(1)}px solid rgba(12,14,18,.56)`,boxShadow:`0 ${px(4)}px ${px(12)}px rgba(12,14,18,.18)`,boxSizing:"border-box"} },
    React.createElement("img", { src:wordmarkSource(), style:{width:px(96),height:px(34),objectFit:"contain"} })),
  React.createElement("div", { style: { display: "flex", position: "absolute", left: px(s.sideInset + s.titleInset), right: px(s.sideInset + s.titleInset), bottom: titleBottom, fontSize: px(s.titleSize), lineHeight: `${px(s.titleLH)}px`, fontWeight: Number(s.titleWeight), maxHeight: px(s.titleLH * s.titleLines), overflow: "hidden" } }, safeText(snapshot.title)),
  snapshot.kind === "curated" ? SLIVER.offsets.map((offset, index) => React.createElement("div", { key: `sliver-${index}`, style: { position: "absolute", left: px(s.sideInset + s.sliver.insets[index]), right: px(s.sideInset + s.sliver.insets[index]), bottom: px(s.bottomInset + s.plateH + offset), height: px(s.sliver.height), borderRadius: px(s.sliver.radius), border: `${px(sliverBoundary.width)}px solid ${sliverBoundary.color}`, background: `linear-gradient(90deg,${s.sliver.opaque[0]},${s.sliver.opaque[1]})` } })) : null,
  React.createElement("div", { style: { position: "absolute", left: px(s.sideInset), bottom: px(s.bottomInset), width: px(s.plateW), height: px(s.plateH), borderRadius: px(s.plateR), border: `${px(boundary.width)}px solid ${boundary.color}`, background: PLATE.fallbackSolid, boxShadow: `inset 0 ${px(1)}px 0 ${PLATE.topHighlight}`, display: "flex", flexDirection:"column", padding:`${px(9)}px ${px(PLATE_SIDE_PADDING)}px ${px(7)}px`, boxSizing:"border-box", fontVariantNumeric:"tabular-nums" } },
    React.createElement("div", { style:{height:px(20),display:"flex",alignItems:"center",fontSize:px(12),lineHeight:`${px(16)}px`,fontWeight:600} }, kindLabel(snapshot.kind)),
    React.createElement("div", { style: { display: "flex", marginTop:px(3), fontSize: px(s.metaSize), lineHeight:`${px(FACT_LINE_HEIGHT)}px`, fontWeight: 500, maxHeight:px(FACT_CLIP_HEIGHT), overflow:"hidden", wordBreak:"break-word" } }, factsLine(facts, s.plateW, s.metaSize)),
  ));
}

async function renderCardIdentityPng(snapshot, surfaceKey) {
  const { ImageResponse } = await import("@vercel/og");
  const s = SURFACES[surfaceKey];
  const scale = ["s4Snippet", "s5Og"].includes(surfaceKey) ? 3 : 1;
  const card = cardIdentityElement({ ...snapshot, cover_url: await prepareCoverForOg(snapshot.cover_url) }, surfaceKey, scale);
  const response = new ImageResponse(card, { width: s.w * scale, height: s.h * scale });
  const png = Buffer.from(await response.arrayBuffer());
  if (png.length === 0 || png.length > MAX_RENDERED_PNG_BYTES) throw new Error("rendered_image_too_large");
  return png;
}

// Static require.resolve is intentionally traceable by Vercel's serverless
// bundler; the workspace dependency guarantees the exact canonical SVG ships.
const WORDMARK_FILE = require.resolve("@mingla/brand-assets/mingla-wordmark.svg");
const wordmarkSource = () => `data:image/svg+xml;base64,${fs.readFileSync(WORDMARK_FILE).toString("base64")}`;
const kindLabel = (kind) => ({ place:"Place", curated:"Curated plan", event:"Event", rsvp_event:"RSVP event", trip:"Trip", experience:"Experience", venue:"Venue", brand:"Brand" })[kind] || "";
const portraitTitleSize = (title) => {
  const count = Array.from(safeText(title)).length;
  return count > 70 ? 23 : count > 48 ? 25 : 27;
};

/** Canonical #1615 portrait composition. S4 and S5 call this same function and
 * therefore receive byte-identical 1080x1350 artwork for one immutable share
 * version; transport encoding is selected after this composition renders.
 *
 * #2589 — the SAME function now also composes the coverless card. Only the
 * photograph layer changes: it is replaced by a generated, luminance-normalised
 * brand-hued field plus a headline stamp carrying the offering's most
 * identifying fact. The pill, title, scrim and plate keep their exact positions,
 * materials and derived contrast values, so a fallback card placed beside a
 * covered one in the same thread reads as the same object with different
 * content. That parity is structural, not copied: there is one composition.
 */
function contentSharePortraitElement(contentShare) {
  const s = SURFACES.s4Snippet;
  const scale = 3;
  const px = (value) => value * scale;
  const facts = contentShare?.facts || {};
  const media = contentShare?.media || facts.media;
  const poster = safeText(media?.posterUrl);
  const boundary = surfacePlateBoundary("s4Snippet");
  const titleSize = portraitTitleSize(facts.title);
  /**
   * #2589 — the title's clip height is COMPUTED, never hardcoded.
   *
   * The shipped card pinned `maxHeight` at 66 while the line height is
   * `max(30, titleSize + 6)`. At the two smaller rungs 66 does not divide the
   * line height: 25pt gives LH 31 (66/31 = 2.13 lines, 4pt of a third line's
   * ascenders visible) and 23pt gives LH 30 (6pt visible). Only the 27pt rung's
   * LH 33 divided cleanly, so every title over ~48 characters — the exact
   * titles long enough to need a third line — shipped with a sliced line across
   * its bottom edge. Deriving it from the line height makes the clip land on a
   * line boundary at every rung.
   */
  const titleLH = Math.max(30, titleSize + 6);
  const titleMaxHeight = titleLH * s.titleLines;
  const status = statusLabel(facts.status);
  const stamp = poster ? null : degradeTo(null, "stamp", () => stampContent(facts));
  const tokens = degradeTo([], "facts", () => selectPreviewFacts(factsWithoutStamped(facts, stamp), 8));
  const titleBottom = s.bottomInset + s.plateH + s.gap;
  const plateUnder = surfacePlateUnder("s4Snippet");
  const plateMaterial = `linear-gradient(${PLATE.lift},${PLATE.lift}),linear-gradient(rgba(${PLATE.underRgb.join(",")},${plateUnder}),rgba(${PLATE.underRgb.join(",")},${plateUnder}))`;
  const field = poster ? null : fieldFor(contentShare?.shortCode);
  // Bottom-anchored so the content reads as ONE cluster and the open space
  // lands in the top third where the field is brightest. Derived, not retyped:
  // if `titleLH` or `titleBottom` ever move, the 20pt clearance moves with them.
  const stampBottom = titleBottom + s.titleLines * s.titleLH + STAMP_TITLE_CLEARANCE;
  return React.createElement("div", { style:{ width:px(s.w),height:px(s.h),position:"relative",display:"flex",overflow:"hidden",
    /**
     * #2589 — SQUARE. No radius is baked into the image, and this is deliberate
     * for the covered card too.
     *
     * A JPEG has no alpha, so a baked `borderRadius` flattens its corners to
     * near-black quarter-circles — invisible against a photograph, glaring
     * against a bright field. PNG with real alpha is 3-4x larger and breaches
     * the 200 KB ceiling on 4 of 5 cards. Every major chat client composites the
     * preview onto its own background and applies its own rounding, so rendering
     * square hands the corner to the only layer that can round it with real
     * transparency: the client.
     */
    color:"white",fontFamily:"Inter, Arial, sans-serif",background:"#0C0E12" } },
    // Satori silently drops a full-bleed `inset: 0` div with a gradient — no
    // error, no warning, a uniform near-black card. Every layer below therefore
    // declares explicit top/left/width/height in px.
    field ? React.createElement("div", { style:{position:"absolute",top:0,left:0,width:px(s.w),height:px(s.h),display:"flex",backgroundImage:`linear-gradient(${field.angle}deg,${field.stops[0]} 0%,${field.stops[1]} 55%,${field.stops[2]} 100%)`} }) : null,
    field ? React.createElement("div", { style:{position:"absolute",top:0,left:0,width:px(s.w),height:px(s.h),display:"flex",backgroundImage:`radial-gradient(circle at ${field.highlightX}% ${field.highlightY}%,rgba(255,255,255,0.34) 0%,rgba(255,255,255,0) 42%)`} }) : null,
    poster ? React.createElement("img", { src:poster, style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:`${Number(media?.focalPoint?.x ?? .5)*100}% ${Number(media?.focalPoint?.y ?? .5)*100}%`} }) : null,
    // Unchanged and unconditional. The scrim's 322pt was derived against a
    // worst case of a pure-WHITE photograph; the field peaks at relative
    // luminance 0.58, strictly inside that case, so every contrast floor the
    // scrim already guarantees holds here by construction.
    React.createElement("div", { style:{position:"absolute",left:0,right:0,bottom:0,height:px(surfaceScrimHeight("s4Snippet")),background:cssGradient(RAMP.bottom)} }),
    React.createElement("div", { style:{position:"absolute",left:px(24),top:px(24),width:px(124),height:px(44),display:"flex",alignItems:"center",justifyContent:"center",borderRadius:px(18),background:"#FFF7EF",border:`${px(1)}px solid rgba(12,14,18,.56)`,boxShadow:`0 ${px(4)}px ${px(12)}px rgba(12,14,18,.18)`,boxSizing:"border-box"} },
      React.createElement("img", { src:wordmarkSource(), style:{width:px(96),height:px(34),objectFit:"contain"} })),
    // The stamp reuses the facts plate's material exactly — zero new tokens. The
    // card therefore has exactly two materials: cream chrome is Mingla's own
    // identity, dark plate glass is the offering's own content.
    stamp ? React.createElement("div", {style:{position:"absolute",left:px(s.sideInset),bottom:px(stampBottom),maxWidth:px(s.plateW),display:"flex",flexDirection:"column",borderRadius:px(s.plateR),border:`${px(boundary.width)}px solid ${boundary.color}`,background:plateMaterial,boxShadow:`inset 0 ${px(1)}px 0 ${PLATE.topHighlight}`,padding:`${px(stamp.padding[0])}px ${px(stamp.padding[1])}px ${px(stamp.padding[2])}px`,boxSizing:"border-box",overflow:"hidden"}},
      React.createElement("div", {style:{display:"flex",fontSize:px(stamp.size),lineHeight:`${px(stamp.size+6)}px`,fontWeight:stamp.weight,letterSpacing:px(stamp.letterSpacing),color:"#FFFFFF",...(stamp.tabular?{fontVariantNumeric:"tabular-nums"}:{})}}, stamp.value),
      stamp.meta ? React.createElement("div", {style:{display:"flex",marginTop:px(4),fontSize:px(14),lineHeight:`${px(18)}px`,fontWeight:600,letterSpacing:px(0.6),color:"rgba(255,255,255,0.80)"}}, stamp.meta) : null) : null,
    React.createElement("div", { style:{position:"absolute",display:"flex",left:px(24),right:px(24),bottom:px(titleBottom),fontSize:px(titleSize),lineHeight:`${px(titleLH)}px`,fontWeight:700,maxHeight:px(titleMaxHeight),overflow:"hidden",wordBreak:"break-word"} }, safeText(facts.title)),
    facts.kind === "curated" ? SLIVER.offsets.map((offset,index)=>React.createElement("div", {key:index,style:{position:"absolute",left:px(s.sideInset+s.sliver.insets[index]),right:px(s.sideInset+s.sliver.insets[index]),bottom:px(s.bottomInset+s.plateH+offset),height:px(4),borderRadius:px(2),background:"rgba(255,255,255,.44)"}})) : null,
    // #2589 — an empty facts row centres the kind label instead of leaving 39pt
    // of dead space below it. `plateH` stays 78, so `scrimHeight`, `plateUnder`
    // and `titleBottom` are all untouched: nothing derived from the plate moves.
    React.createElement("div", {style:{position:"absolute",left:px(s.sideInset),bottom:px(s.bottomInset),width:px(s.plateW),height:px(s.plateH),borderRadius:px(s.plateR),border:`${px(boundary.width)}px solid ${boundary.color}`,background:plateMaterial,display:"flex",flexDirection:"column",justifyContent:tokens.length?"flex-start":"center",padding:`${px(9)}px ${px(PLATE_SIDE_PADDING)}px ${px(7)}px`,boxSizing:"border-box",fontVariantNumeric:"tabular-nums"}},
      React.createElement("div", {style:{height:px(20),display:"flex",alignItems:"center",fontSize:px(12),lineHeight:`${px(16)}px`,fontWeight:600}},
        React.createElement("span", null, kindLabel(facts.kind)),
        status ? React.createElement("span", {style:{marginLeft:"auto",height:px(20),padding:`0 ${px(8)}px`,display:"flex",alignItems:"center",borderRadius:px(10),background:"#FFF7EF",color:"#0C0E12",fontWeight:700}}, `● ${status}`) : null),
      tokens.length ? React.createElement("div", {style:{display:"flex",marginTop:px(3),fontSize:px(13),lineHeight:`${px(FACT_LINE_HEIGHT)}px`,fontWeight:500,maxHeight:px(FACT_CLIP_HEIGHT),overflow:"hidden",wordBreak:"break-word"}}, factsLine(tokens, s.plateW, 13)) : null));
}

async function renderContentSharePortraitPng(contentShare) {
  const { ImageResponse } = await import("@vercel/og");
  const media = contentShare?.media || contentShare?.facts?.media;
  const source = safeText(media?.posterUrl);
  /**
   * #2589 — an unusable cover is a FALLBACK CASE, not a failure.
   *
   * All three coverless populations converge here: no cover at all (no
   * `posterUrl`), a cover the pipeline rejects (host off the allowlist, wrong
   * MIME, oversize, fetch timeout), and a video or GIF whose poster is missing
   * or unfetchable. Every one of them used to reach `throw` and surface as a 502
   * with an empty body, so the page omitted `og:image` and the link shared as a
   * bare URL. They now render the generated card instead.
   *
   * `posterUrl: ""` is passed EXPLICITLY rather than dropping `media`, because
   * the element falls back to `facts.media` when `media` is absent — which would
   * hand the composition an unprepared remote URL that never went through
   * `prepareCoverForOg`.
   */
  let posterUrl = "";
  if (source) {
    try { posterUrl = await prepareCoverForOg(source); }
    catch (error) { console.warn("issue-2589 cover unusable, rendering fallback card:", error?.message || error); }
  }
  const element = contentSharePortraitElement({ ...contentShare, media: { ...(media || {}), posterUrl } });
  const response = new ImageResponse(element, { width:1080, height:1350 });
  const png = Buffer.from(await response.arrayBuffer());
  if (png.length === 0 || png.length > MAX_RENDERED_PNG_BYTES) throw new Error("rendered_image_too_large");
  return png;
}

async function isValidContentSharePortraitJpeg(value, sharpImpl = require("sharp")) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > MAX_CONTENT_SHARE_JPEG_BYTES) return false;
  try {
    const options = { limitInputPixels: 20_000_000, failOn: "error", sequentialRead: true };
    const metadata = await sharpImpl(value, options).metadata();
    if (metadata.format !== "jpeg" || metadata.width !== 1080 || metadata.height !== 1350) return false;
    const decoded = await sharpImpl(value, options).raw().toBuffer({ resolveWithObject: true });
    return decoded.data.length > 0 && decoded.info.width === 1080 && decoded.info.height === 1350;
  } catch {
    return false;
  }
}

async function renderContentSharePortraitJpeg(contentShare) {
  const png = await renderContentSharePortraitPng(contentShare);
  const sharp = require("sharp");
  for (const quality of CONTENT_SHARE_JPEG_QUALITIES) {
    const jpeg = await sharp(png, { limitInputPixels: 20_000_000, failOn: "error" })
      .flatten({ background: "#0C0E12" })
      .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
    if (jpeg.length === 0 || jpeg.length > MAX_CONTENT_SHARE_JPEG_BYTES) continue;
    if (!(await isValidContentSharePortraitJpeg(jpeg, sharp))) {
      throw new Error("invalid_rendered_share_portrait");
    }
    return jpeg;
  }
  throw new Error("rendered_share_portrait_too_large");
}

function businessRowSnapshot(props) {
  return {
    kind: "place",
    title: safeText(props.title),
    cover_url: safeText(props.coverUrl),
    metadata: {
      category: safeText(props.kicker),
      location: safeText(props.locationLabel || props.nextEventLabel),
      duration: safeText(props.dateLabel || props.eventCountLabel),
    },
  };
}

function useDirectionC(req) {
  const preview = Array.isArray(req?.query?.v) ? req.query.v[0] : req?.query?.v;
  return preview === "c" || process.env.MINGLA_CARD_IDENTITY_OG_ENABLED === "true";
}

function s6CardCss() {
  const s = SURFACES.s6Phone;
  const boundary = surfacePlateBoundary("s6Phone");
  // S6 is single/curated from the same snapshot, so the selector is consumed
  // even when a particular row does not need the sliver stack.
  const sliverBoundary = surfaceSliverBoundary("s6Phone");
  const underColor = `rgba(${PLATE.underRgb.join(",")},${surfacePlateUnder("s6Phone")})`;
  return `.share-cover{height:${s.h}px;max-width:${s.w}px;margin:auto;border-radius:${s.cardR}px;position:relative;overflow:hidden}.share-cover-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.share-cover:after{content:"";position:absolute;left:0;right:0;bottom:0;height:${surfaceScrimHeight("s6Phone")}px;background:${cssGradient(RAMP.bottom)}}.share-identity-pill{z-index:2;position:absolute;left:24px;top:24px;width:124px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:18px;background:#FFF7EF;border:1px solid rgba(12,14,18,.56);box-shadow:0 4px 12px rgba(12,14,18,.18);box-sizing:border-box}.share-identity-pill img{width:96px;height:34px;object-fit:contain}.share-title{z-index:2;position:absolute;left:${s.sideInset + s.titleInset}px;right:${s.sideInset + s.titleInset}px;bottom:${s.bottomInset + s.plateH + s.gap}px;font-size:${s.titleSize}px;line-height:${s.titleLH}px;font-weight:${s.titleWeight}}.share-plate{z-index:2;position:absolute;left:${s.sideInset}px;right:${s.sideInset}px;bottom:${s.bottomInset}px;height:${s.plateH}px;border:${boundary.width}px solid ${boundary.color};border-radius:${s.plateR}px;background:linear-gradient(${PLATE.lift},${PLATE.lift}),linear-gradient(${underColor},${underColor});backdrop-filter:blur(${PLATE.blurIntensity}px);-webkit-backdrop-filter:blur(${PLATE.blurIntensity}px);box-shadow:inset 0 1px 0 ${PLATE.topHighlight};display:flex;flex-direction:column;justify-content:center;padding:7px 12px;box-sizing:border-box}.share-plate-kind{font-size:12px;line-height:16px;font-weight:600}.share-plate-facts{font-size:${s.metaSize}px;line-height:16px;font-weight:500}@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.share-plate{background:${PLATE.fallbackSolid}}}.share-curated-sliver{z-index:1;position:absolute;height:${s.sliver.height}px;border-radius:${s.sliver.radius}px;border:${sliverBoundary.width}px solid ${sliverBoundary.color};background:linear-gradient(90deg,${s.sliver.opaque[0]},${s.sliver.opaque[1]})}.share-curated-sliver.one{left:${s.sideInset + s.sliver.insets[0]}px;right:${s.sideInset + s.sliver.insets[0]}px;bottom:${s.bottomInset + s.plateH + SLIVER.offsets[0]}px}.share-curated-sliver.two{left:${s.sideInset + s.sliver.insets[1]}px;right:${s.sideInset + s.sliver.insets[1]}px;bottom:${s.bottomInset + s.plateH + SLIVER.offsets[1]}px}`;
}

module.exports = { MAX_CONTENT_SHARE_JPEG_BYTES, MAX_RENDERED_PNG_BYTES, businessRowSnapshot, cardIdentityElement, contentSharePortraitElement, factsFor, isAllowedPublicPoster, isValidContentSharePortraitJpeg, prepareCoverForOg, renderCardIdentityPng, renderContentSharePortraitJpeg, renderContentSharePortraitPng, s6CardCss, useDirectionC, wordmarkSource };
