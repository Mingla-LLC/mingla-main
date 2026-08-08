'use strict';

// Deferred install only. This URL is an S6 CTA target and is never the visible
// content URL, canonical, message URL, or metadata URL.
const contentShareOneLink = (code, referralCode = "") => {
  const params = new URLSearchParams({ pid:"content_share", deep_link_value:"content_share", deep_link_sub1:String(code) });
  if (/^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/.test(referralCode)) params.set("af_sub1", referralCode);
  return `https://go.usemingla.com/w36m?${params.toString()}`;
};

module.exports = { contentShareOneLink };
