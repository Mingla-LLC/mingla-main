const React = require("react");
const {
  RAMP,
  PLATE,
  SLIVER,
  SURFACES,
  surfaceScrimHeight,
  surfacePlateUnder,
  surfacePlateBoundary,
  surfaceSliverBoundary,
} = require("@mingla/card-identity");

const cssGradient = (ramp) => `linear-gradient(180deg,${ramp.colors.map((color, index) => `${color} ${Math.round(ramp.locations[index] * 100)}%`).join(",")})`;

const safeText = (value) => typeof value === "string" ? value.trim() : "";
const factsFor = (snapshot) => {
  const m = snapshot && snapshot.metadata && typeof snapshot.metadata === "object" ? snapshot.metadata : {};
  return [m.category, m.location, m.price, m.duration].map(safeText).filter(Boolean).slice(0, 2);
};

/** The sole S4/S5 visual substrate. Geometry and boundaries come from the
 * measured package descriptors; this file owns composition, never copied tokens. */
function cardIdentityElement(snapshot, surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s || !["s4Snippet", "s5Og"].includes(surfaceKey)) throw new Error("unsupported share surface");
  const boundary = surfacePlateBoundary(surfaceKey);
  const sliverBoundary = surfaceSliverBoundary(surfaceKey);
  const facts = factsFor(snapshot);
  const titleBottom = s.bottomInset + s.plateH + s.gap;
  const scrimH = surfaceScrimHeight(surfaceKey);
  const cover = safeText(snapshot.cover_url);
  if (!cover) throw new Error("cover_required");
  return React.createElement("div", { style: {
    width: s.w, height: s.h, display: "flex", position: "relative", overflow: "hidden",
    borderRadius: s.cardR, color: "white", fontFamily: "Inter, Arial, sans-serif", background: "#171717",
  } },
  React.createElement("img", { src: cover, style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } }),
  React.createElement("div", { style: { position: "absolute", left: 0, right: 0, bottom: 0, height: scrimH, background: cssGradient(RAMP.bottom) } }),
  React.createElement("div", { style: { display: "flex", position: "absolute", left: s.sideInset + s.titleInset, right: s.sideInset + s.titleInset, bottom: titleBottom, fontSize: s.titleSize, lineHeight: `${s.titleLH}px`, fontWeight: Number(s.titleWeight), maxHeight: s.titleLH * s.titleLines, overflow: "hidden" } }, safeText(snapshot.title)),
  snapshot.kind === "curated" ? SLIVER.offsets.map((offset, index) => React.createElement("div", { key: `sliver-${index}`, style: { position: "absolute", left: s.sideInset + s.sliver.insets[index], right: s.sideInset + s.sliver.insets[index], bottom: s.bottomInset + s.plateH + offset, height: s.sliver.height, borderRadius: s.sliver.radius, border: `${sliverBoundary.width}px solid ${sliverBoundary.color}`, background: `linear-gradient(90deg,${s.sliver.opaque[0]},${s.sliver.opaque[1]})` } })) : null,
  React.createElement("div", { style: { position: "absolute", left: s.sideInset, bottom: s.bottomInset, width: s.plateW, height: s.plateH, borderRadius: s.plateR, border: `${boundary.width}px solid ${boundary.color}`, background: PLATE.fallbackSolid, boxShadow: `inset 0 1px 0 ${PLATE.topHighlight}`, display: "flex", alignItems: "center", paddingLeft: s.titleInset, paddingRight: s.titleInset } },
    React.createElement("div", { style: { display: "flex", fontSize: s.metaSize, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, facts.join(" · ")),
    React.createElement("div", { style: { display: "flex", marginLeft: "auto", color: "rgba(255,255,255,0.72)", fontSize: Math.max(13, Math.round(s.metaSize * .72)), fontWeight: 800 } }, "mingla"),
  ));
}

async function renderCardIdentityPng(snapshot, surfaceKey) {
  const { ImageResponse } = await import("@vercel/og");
  const s = SURFACES[surfaceKey];
  const scale = surfaceKey === "s4Snippet" ? 3 : 1;
  const card = cardIdentityElement(snapshot, surfaceKey);
  const element = scale === 1 ? card : React.createElement("div", { style: { width: s.w * scale, height: s.h * scale, display: "flex" } }, React.createElement("div", { style: { display: "flex", width: s.w, height: s.h, transform: `scale(${scale})`, transformOrigin: "top left" } }, card));
  const response = new ImageResponse(element, { width: s.w * scale, height: s.h * scale });
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

module.exports = { businessRowSnapshot, cardIdentityElement, factsFor, renderCardIdentityPng, s6CardCss, useDirectionC };
