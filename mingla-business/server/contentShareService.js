'use strict';

// Deferred install only. This URL is an S6 CTA target and is never the visible
// content URL, canonical, message URL, or metadata URL.
const contentShareOneLink = (code) =>
  `https://go.usemingla.com/w36m?pid=content_share&deep_link_value=content_share&deep_link_sub1=${encodeURIComponent(code)}`;

module.exports = { contentShareOneLink };
