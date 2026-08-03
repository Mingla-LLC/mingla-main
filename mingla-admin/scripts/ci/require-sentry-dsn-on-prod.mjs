#!/usr/bin/env node
// #1322 — fail a Vercel PRODUCTION build of mingla-admin when VITE_SENTRY_DSN is
// absent, so admin-console crash reporting can never silently ship dark. Preview /
// branch / local builds only warn (the DSN may legitimately be absent there).
const dsn = (process.env.VITE_SENTRY_DSN ?? "").trim();
const isProd = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
if (dsn) {
  console.log("[require-sentry-dsn] VITE_SENTRY_DSN present — admin crash reporting will ship live.");
  process.exit(0);
}
if (isProd) {
  console.error(
    "\n[require-sentry-dsn] FATAL: VITE_SENTRY_DSN is absent on a Vercel PRODUCTION build of mingla-admin.\n" +
      "Crash reporting would ship DARK (issue #1322). Set VITE_SENTRY_DSN in the mingla-admin Vercel\n" +
      "project env for Production (value = the shared mingla-business Sentry project DSN). Aborting build.\n",
  );
  process.exit(1);
}
console.warn(
  "[require-sentry-dsn] VITE_SENTRY_DSN absent — allowed (not a Vercel production build). " +
    "Admin crash reporting will be a no-op in this build.",
);
process.exit(0);
