import React from "react";

const links = [
  ["Pages", "/admin/collections/pages"], ["Media", "/admin/collections/media"],
  ["Navigation", "/admin/collections/navigation"], ["Footer", "/admin/collections/footer"],
  ["Site settings & SEO", "/admin/collections/site-settings"],
  ["Preview", "/api/mingla/studio-preview"],
  ["View live site", "https://gogi.sites.usemingla.com"], ["Return to Mingla", "/api/mingla/return"],
] as const;

export default function StudioNav() {
  return <nav className="studio-nav" aria-label="Mingla Studio"><div className="studio-wordmark">Mingla Studio</div>{links.map(([label, href]) => <a key={label} href={href}>{label}</a>)}<p className="studio-note">Restaurant Website v1</p></nav>;
}
