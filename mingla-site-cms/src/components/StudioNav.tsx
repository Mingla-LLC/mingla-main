import React from "react";

// #2829 — "View live site" goes through the CMS, which redirects to the
// signed-in tenant's own primary address (never one fixed brand's).
const links = [
  ["Pages", "/admin/collections/pages"], ["Media", "/studio/media"],
  ["Navigation", "/admin/collections/navigation"], ["Footer", "/admin/collections/footer"],
  ["Site settings & SEO", "/admin/collections/site-settings"],
  // #2829 W9b — every change Ari made, why, and what it was based on.
  ["Why it looks like this", "/admin/collections/work-log"],
  ["Preview", "/api/mingla/studio-preview"],
  ["View live site", "/api/mingla/live-site"], ["Return to Mingla", "/api/mingla/return"],
] as const;

export default function StudioNav() {
  return <nav className="studio-nav" aria-label="Mingla Studio"><div className="studio-wordmark">Mingla Studio</div>{links.map(([label, href]) => <a key={label} href={href}>{label}</a>)}<p className="studio-note">Your website</p></nav>;
}
