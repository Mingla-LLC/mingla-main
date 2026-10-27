import { withPayload } from "@payloadcms/next/withPayload";

// #2829 — a Vercel build with a local-mode variable fails here, so a mis-set
// project variable stops the deploy instead of shipping a weakened build.
// Kept inline (not imported from src/lib/localMode.ts) because this file is
// plain ESM loaded before TypeScript; localMode.issue2829.test.ts pins the
// two copies to the same rule.
const vercelMarker = ["VERCEL", "VERCEL_ENV"].some((name) => process.env[name]);
const localSignal = ["SITES_LOCAL_MODE", "SITES_LOCAL_EXTRA_HOSTS"].some(
  (name) => process.env[name],
);
if (vercelMarker && localSignal) {
  throw new Error(
    "SITES_LOCAL_MODE_FORBIDDEN_ON_VERCEL: remove SITES_LOCAL_MODE / SITES_LOCAL_EXTRA_HOSTS from this Vercel project",
  );
}

export default withPayload({
  poweredByHeader: false,
  reactStrictMode: true,
  reactCompiler: false,
});
