// ISSUE-1001 [brand logo consolidation] — canonical Mingla brand-asset masters.
//
// This package is the SINGLE committed source of truth for every Mingla mark
// (I-PROPOSED-1001-BRAND-ASSET-CANON). Every other copy in the repo is either
// a parity-checked serving mirror (static-host public/ dirs — enforced
// byte-identical by .github/scripts/strict-grep/issue-1001-brand-asset-parity.mjs)
// or an Expo-required per-app build derivative (app icons/splash — documented,
// never imported from here).
//
// Only app-imported marks are exported; the email/vector masters
// are file-level canon consumed by the parity gate and the hosted mirrors.
// This package deliberately ships ZERO dependencies and NO node_modules
// (single-React rule — see app-mobile/metro.config.js).

/* eslint-disable @typescript-eslint/no-require-imports */
export const MINGLA_WORDMARK = require("./mingla-wordmark.png") as number;
export const MINGLA_BUSINESS_LOGO = require("./mingla-business-logo.png") as number;
export const MINGLA_APP_ICON = require("./mingla-app-icon-500.png") as number;
