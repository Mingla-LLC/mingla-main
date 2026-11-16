// #4452 §7.4 — what the builder's preview frame is given. The frame is an
// iframe srcdoc with a Content-Security-Policy that allows the kit's own
// script, style and font from Admin's origin, images over https, and NO
// connection of any kind (connect-src 'none'; form-action 'none'): a preview
// can never submit, track or fetch.

/** The kit page for the frame. `origin` is Admin's (where /forms-kit/ is served). */
export function kitSrcDoc(origin) {
  const o = String(origin || "").replace(/[^a-zA-Z0-9:/.\-[\]]/g, "");
  const csp = [
    "default-src 'none'",
    `script-src ${o}/forms-kit/`,
    `style-src ${o}/forms-kit/ 'unsafe-inline'`,
    `font-src ${o}/fonts/`,
    "img-src https: data:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<link rel="stylesheet" href="${o}/forms-kit/forms-kit.css">`
    + `<style>@font-face{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:swap;src:url("${o}/fonts/InstrumentSerif-latin-400-normal.woff2") format("woff2")}</style>`
    + `</head><body><div id="kit"></div><script src="${o}/forms-kit/forms-kit.js"></script></body></html>`;
}

/** The draft as the site's public form shape, always in preview mode. */
export function previewForm(form, def) {
  return {
    id: form?.id || "preview",
    key: form?.key || "preview",
    name: form?.name || "Preview",
    version: 0,
    audience: def?.audience || "creator",
    fields: Array.isArray(def?.fields) ? def.fields : [],
    design: def?.design || {},
    slug: def?.own_page?.on ? def.own_page.slug || null : null,
    preview: true,
  };
}
