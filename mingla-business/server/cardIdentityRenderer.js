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
const { selectPreviewFacts, statusLabel } = require("../../packages/sharing");

const cssGradient = (ramp) => `linear-gradient(180deg,${ramp.colors.map((color, index) => `${color} ${Math.round(ramp.locations[index] * 100)}%`).join(",")})`;

const safeText = (value) => typeof value === "string" ? value.trim() : "";
const MINGLA_STORAGE_HOST = "gqnoajqerqhnvulmnyvv.supabase.co";
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const isMinglaStorageWebp = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === MINGLA_STORAGE_HOST
      && url.pathname.startsWith("/storage/v1/object/public/") && /\.webp$/i.test(url.pathname);
  } catch { return false; }
};
async function prepareCoverForOg(cover, fetchImpl = fetch, sharpImpl) {
  const source = safeText(cover);
  if (!isMinglaStorageWebp(source)) return source;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(source, { redirect: "error", signal: controller.signal });
    const declaredSize = Number(response.headers.get("content-length") || "0");
    if (!response.ok || !/^image\/webp(?:;|$)/i.test(response.headers.get("content-type") || "")
      || declaredSize > MAX_COVER_BYTES) throw new Error("cover_unavailable");
    const input = Buffer.from(await response.arrayBuffer());
    if (input.length === 0 || input.length > MAX_COVER_BYTES) throw new Error("cover_unavailable");
    const sharp = sharpImpl || require("sharp");
    const png = await sharp(input, { limitInputPixels: 20_000_000 })
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
  React.createElement("div", { style: { display: "flex", position: "absolute", left: px(s.sideInset + s.titleInset), right: px(s.sideInset + s.titleInset), bottom: titleBottom, fontSize: px(s.titleSize), lineHeight: `${px(s.titleLH)}px`, fontWeight: Number(s.titleWeight), maxHeight: px(s.titleLH * s.titleLines), overflow: "hidden" } }, safeText(snapshot.title)),
  snapshot.kind === "curated" ? SLIVER.offsets.map((offset, index) => React.createElement("div", { key: `sliver-${index}`, style: { position: "absolute", left: px(s.sideInset + s.sliver.insets[index]), right: px(s.sideInset + s.sliver.insets[index]), bottom: px(s.bottomInset + s.plateH + offset), height: px(s.sliver.height), borderRadius: px(s.sliver.radius), border: `${px(sliverBoundary.width)}px solid ${sliverBoundary.color}`, background: `linear-gradient(90deg,${s.sliver.opaque[0]},${s.sliver.opaque[1]})` } })) : null,
  React.createElement("div", { style: { position: "absolute", left: px(s.sideInset), bottom: px(s.bottomInset), width: px(s.plateW), height: px(s.plateH), borderRadius: px(s.plateR), border: `${px(boundary.width)}px solid ${boundary.color}`, background: PLATE.fallbackSolid, boxShadow: `inset 0 ${px(1)}px 0 ${PLATE.topHighlight}`, display: "flex", alignItems: "center", paddingLeft: px(s.titleInset), paddingRight: px(s.titleInset) } },
    React.createElement("div", { style: { display: "flex", fontSize: px(s.metaSize), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, facts.join(" · ")),
    React.createElement("div", { style: { display: "flex", marginLeft: "auto", color: "rgba(255,255,255,0.72)", fontSize: px(Math.max(13, Math.round(s.metaSize * .72))), fontWeight: 800 } }, "mingla"),
  ));
}

async function renderCardIdentityPng(snapshot, surfaceKey) {
  const { ImageResponse } = await import("@vercel/og");
  const s = SURFACES[surfaceKey];
  const scale = ["s4Snippet", "s5Og"].includes(surfaceKey) ? 3 : 1;
  const card = cardIdentityElement({ ...snapshot, cover_url: await prepareCoverForOg(snapshot.cover_url) }, surfaceKey, scale);
  const response = new ImageResponse(card, { width: s.w * scale, height: s.h * scale });
  return Buffer.from(await response.arrayBuffer());
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

/** Canonical #1615 portrait. S4 and S5 call this same function and therefore
 * receive byte-identical 1080x1350 PNGs for one immutable share version. */
function contentSharePortraitElement(contentShare) {
  const s = SURFACES.s4Snippet;
  const scale = 3;
  const px = (value) => value * scale;
  const facts = contentShare?.facts || {};
  const media = contentShare?.media || facts.media;
  const poster = safeText(media?.posterUrl);
  const boundary = surfacePlateBoundary("s4Snippet");
  const titleSize = portraitTitleSize(facts.title);
  const status = statusLabel(facts.status);
  const tokens = selectPreviewFacts(facts, 8);
  const titleBottom = px(s.bottomInset + s.plateH + s.gap);
  const plateUnder = surfacePlateUnder("s4Snippet");
  return React.createElement("div", { style:{ width:px(s.w),height:px(s.h),position:"relative",display:"flex",overflow:"hidden",borderRadius:px(s.cardR),color:"white",fontFamily:"Inter, Arial, sans-serif",background:"#0C0E12" } },
    poster ? React.createElement("img", { src:poster, style:{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:`${Number(media?.focalPoint?.x ?? .5)*100}% ${Number(media?.focalPoint?.y ?? .5)*100}%`} }) : null,
    poster ? React.createElement("div", { style:{position:"absolute",left:0,right:0,bottom:0,height:px(surfaceScrimHeight("s4Snippet")),background:cssGradient(RAMP.bottom)} }) : null,
    React.createElement("div", { style:{position:"absolute",left:px(24),top:px(24),height:px(38),padding:`0 ${px(12)}px`,display:"flex",alignItems:"center",borderRadius:px(19),background:"#FFF7EF",border:`${px(1)}px solid rgba(12,14,18,.56)`,boxShadow:`0 ${px(4)}px ${px(12)}px rgba(12,14,18,.18)`} },
      React.createElement("img", { src:wordmarkSource(), style:{width:px(91),height:px(25),objectFit:"contain"} })),
    React.createElement("div", { style:{position:"absolute",display:"flex",left:px(24),right:px(24),bottom:titleBottom,fontSize:px(titleSize),lineHeight:`${px(Math.max(30,titleSize+6))}px`,fontWeight:700,maxHeight:px(66),overflow:"hidden",wordBreak:"break-word"} }, safeText(facts.title)),
    facts.kind === "curated" ? SLIVER.offsets.map((offset,index)=>React.createElement("div", {key:index,style:{position:"absolute",left:px(s.sideInset+s.sliver.insets[index]),right:px(s.sideInset+s.sliver.insets[index]),bottom:px(s.bottomInset+s.plateH+offset),height:px(4),borderRadius:px(2),background:"rgba(255,255,255,.44)"}})) : null,
    React.createElement("div", {style:{position:"absolute",left:px(s.sideInset),bottom:px(s.bottomInset),width:px(s.plateW),height:px(s.plateH),borderRadius:px(s.plateR),border:`${px(boundary.width)}px solid ${boundary.color}`,background:`linear-gradient(${PLATE.lift},${PLATE.lift}),linear-gradient(rgba(${PLATE.underRgb.join(",")},${plateUnder}),rgba(${PLATE.underRgb.join(",")},${plateUnder}))`,display:"flex",flexDirection:"column",padding:`${px(9)}px ${px(12)}px ${px(7)}px`,boxSizing:"border-box",fontVariantNumeric:"tabular-nums"}},
      React.createElement("div", {style:{height:px(20),display:"flex",alignItems:"center",fontSize:px(12),lineHeight:`${px(16)}px`,fontWeight:600}},
        React.createElement("span", null, kindLabel(facts.kind)),
        status ? React.createElement("span", {style:{marginLeft:"auto",height:px(20),padding:`0 ${px(8)}px`,display:"flex",alignItems:"center",borderRadius:px(10),background:"#FFF7EF",color:"#0C0E12",fontWeight:700}}, `● ${status}`) : null),
      React.createElement("div", {style:{display:"flex",marginTop:px(3),fontSize:px(13),lineHeight:`${px(16)}px`,fontWeight:500,maxHeight:px(32),overflow:"hidden",wordBreak:"break-word"}}, tokens.join(" · "))));
}

async function renderContentSharePortraitPng(contentShare) {
  const { ImageResponse } = await import("@vercel/og");
  const element = contentSharePortraitElement(contentShare);
  const response = new ImageResponse(element, { width:1080, height:1350 });
  return Buffer.from(await response.arrayBuffer());
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
  return `.share-cover{height:${s.h}px;max-width:${s.w}px;margin:auto;border-radius:${s.cardR}px;position:relative;overflow:hidden}.share-cover-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.coverless{background:${PLATE.fallbackSolid}}.share-cover:after{content:"";position:absolute;left:0;right:0;bottom:0;height:${surfaceScrimHeight("s6Phone")}px;background:${cssGradient(RAMP.bottom)}}.share-title{z-index:2;position:absolute;left:${s.sideInset + s.titleInset}px;right:${s.sideInset + s.titleInset}px;bottom:${s.bottomInset + s.plateH + s.gap}px;font-size:${s.titleSize}px;line-height:${s.titleLH}px;font-weight:${s.titleWeight}}.share-plate{z-index:2;position:absolute;left:${s.sideInset}px;right:${s.sideInset}px;bottom:${s.bottomInset}px;height:${s.plateH}px;border:${boundary.width}px solid ${boundary.color};border-radius:${s.plateR}px;background:linear-gradient(${PLATE.lift},${PLATE.lift}),linear-gradient(${underColor},${underColor});backdrop-filter:blur(${PLATE.blurIntensity}px);-webkit-backdrop-filter:blur(${PLATE.blurIntensity}px);box-shadow:inset 0 1px 0 ${PLATE.topHighlight};display:flex;align-items:center;padding:0 ${s.titleInset}px;font-size:${s.metaSize}px}.share-plate strong{margin-left:auto;color:rgba(255,255,255,.72)}@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.share-plate{background:${PLATE.fallbackSolid}}}.share-curated-sliver{z-index:1;position:absolute;height:${s.sliver.height}px;border-radius:${s.sliver.radius}px;border:${sliverBoundary.width}px solid ${sliverBoundary.color};background:linear-gradient(90deg,${s.sliver.opaque[0]},${s.sliver.opaque[1]})}.share-curated-sliver.one{left:${s.sideInset + s.sliver.insets[0]}px;right:${s.sideInset + s.sliver.insets[0]}px;bottom:${s.bottomInset + s.plateH + SLIVER.offsets[0]}px}.share-curated-sliver.two{left:${s.sideInset + s.sliver.insets[1]}px;right:${s.sideInset + s.sliver.insets[1]}px;bottom:${s.bottomInset + s.plateH + SLIVER.offsets[1]}px}`;
}

module.exports = { businessRowSnapshot, cardIdentityElement, contentSharePortraitElement, factsFor, prepareCoverForOg, renderCardIdentityPng, renderContentSharePortraitPng, s6CardCss, useDirectionC, wordmarkSource };
