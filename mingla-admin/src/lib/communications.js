// Issue #4383 — the Communications menu group: what we tell hosts and
// explorers, each its own screen.
//
// Pure module: no React, no Supabase, so the plain node tests run it.

/** The screens Overview links to, in menu order (Overview itself excluded). */
export const COMMUNICATIONS_SCREENS = Object.freeze([
  Object.freeze({ id: "announcements", label: "Announcements", description: "What every host sees on Host Home, in their bell and as a push." }),
  Object.freeze({ id: "roadmap", label: "Roadmap", description: "What hosts see on the public roadmap." }),
  Object.freeze({ id: "email", label: "Email", description: "Write, schedule and track emails to hosts, creators and Locals." }),
  Object.freeze({ id: "blog", label: "Blog", description: "Posts on usemingla.com/blog." }),
  Object.freeze({ id: "links", label: "Links page", description: "The strips on usemingla.com/links." }),
]);
