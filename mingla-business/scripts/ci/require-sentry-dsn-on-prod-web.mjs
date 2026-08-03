#!/usr/bin/env node
// #890 — fail a Vercel PRODUCTION web build when EXPO_PUBLIC_SENTRY_DSN is
// absent, so web crash reporting can never silently ship dark again. Preview /
// branch / local builds only warn — the DSN may legitimately be absent there.
const dsn = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
const isProdWeb = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";

if (dsn) {
  console.log("[require-sentry-dsn] EXPO_PUBLIC_SENTRY_DSN present — web crash reporting will ship live.");
  process.exit(0);
}
if (isProdWeb) {
  console.error(
    "\n[require-sentry-dsn] FATAL: EXPO_PUBLIC_SENTRY_DSN is absent on a Vercel PRODUCTION web build.\n" +
      "Crash reporting would ship DARK (issue #890). Set EXPO_PUBLIC_SENTRY_DSN in the mingla-business\n" +
      "Vercel project env for Production (value from EAS production env). Aborting build.\n",
  );
  process.exit(1);
}
console.warn(
  "[require-sentry-dsn] EXPO_PUBLIC_SENTRY_DSN absent — allowed (not a Vercel production web build). " +
    "Web crash reporting will be a no-op in this build.",
);
process.exit(0);
