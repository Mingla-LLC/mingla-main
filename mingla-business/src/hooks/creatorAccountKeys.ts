/**
 * ORCH-1251 — React Query key factory for the creator-account query, extracted
 * into its own keyless module so AuthContext.tsx can import `creatorAccountKeys`
 * (for the token-attach cache reconcile) WITHOUT a require-cycle through
 * useCreatorAccount.ts (which imports `useAuth` from AuthContext). Pure constants
 * — no React, no RN imports, no AuthContext import.
 *
 * Cycle that would otherwise be introduced (detected by
 * `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs`):
 *   AuthContext.tsx → useCreatorAccount.ts → AuthContext.tsx (for creatorAccountKeys)
 * Breaking via this module is the canonical fix per the cycle gate's help text
 * (same pattern as ORCH-0965's upcomingKeys.ts).
 *
 * The canonical home for these keys is HERE; useCreatorAccount.ts re-exports them
 * for backward compat so all existing importers keep working.
 */

export const creatorAccountKeys = {
  all: ["creator-account"] as const,
  byId: (userId: string): readonly [string, string] =>
    ["creator-account", userId] as const,
};
