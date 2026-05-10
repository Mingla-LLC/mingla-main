# Pre-Release Protocol

Use for TestFlight, Google Play, submission readiness, or explicit launch audits. Platform rules can change; for high-stakes submission questions, verify current official platform docs or current project config.

## Scope

Read:

- Recent implementation/QA reports.
- Changed files since last release if known.
- `README.md` contracts.
- App config, permissions, privacy manifests, package files, EAS/build config.
- Critical flows and deploy notes.

## iOS

Check:

- Cold start, warm start, background resume, token refresh.
- Network failure, Supabase downtime, deleted-content deep link.
- Privacy manifest and usage descriptions.
- Sign in with Apple parity where required.
- Account deletion access.
- Location permission timing and copy.
- ATT prompt timing if tracking.
- In-app purchase/subscription terms and restore purchases for digital goods.
- Safe areas, Dynamic Type, VoiceOver, screenshots match behavior.
- Native dependency changes require native build, not OTA only.

## Android

Check:

- Crash/ANR risk, hardware back, low memory/task kill.
- Runtime permissions at point of use.
- Notification permission on Android 13+.
- Target SDK/build config.
- Google Play Billing for digital goods where applicable.
- Keyboard and screen-density behavior.
- Maps/location fallback.
- TalkBack and font scaling.

## Performance

Check:

- Cold start target and startup blocking.
- Query waterfalls.
- List virtualization.
- Image sizes and caching.
- Subscriptions cleanup.
- Memory leaks on repeated navigation.
- Battery impact for location/background work.
- Bundle size and accidental heavy imports.

## Privacy / Legal

Check:

- Data collection matches privacy labels/Data Safety.
- Terms/privacy accessible.
- No placeholder/test content.
- No secrets or service-role keys in client.
- Analytics does not fire before consent where applicable.

## Release Verdict

- P0/P1 blocks submission.
- Conditional pass may include deploy order, manual device checks, migration application, edge deploy, or store metadata updates.
