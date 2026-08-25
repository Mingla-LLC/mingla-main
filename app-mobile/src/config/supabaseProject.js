// supabaseProject — THE single owner of the consumer app's Supabase project URL.
//
// #1594 [consumer-map-url]. Before this file, the URL had exactly one owner —
// the literal at `src/services/supabase.ts` — and that was correct. The problem
// was that ONE reader could not see it.
//
// THE BUG THIS CLOSES. `packages/offering-rendering/mapboxFunctionsBase.ts` is
// the shared owner of the "Where you'll be" / "Where you'll start" static map on
// the public venue, trip, experience and RSVP surfaces. It resolves its base
// through `Constants.expoConfig.extra.EXPO_PUBLIC_SUPABASE_URL`, on the strength
// of a comment asserting that "every app already ships" that key in `extra`.
// `mingla-business` does (`app.config.js`). `app-mobile` never has: it does not
// use an environment variable for its project URL at all. So the resolver
// returned null on every consumer build, `buildStaticMapUrl` returned null, and
// all four callers HID the map — fail-safe (Constitution rule 9), and therefore
// silent. Nothing ever flagged it; it took a device pass on #1550 to notice.
//
// WHY A SEPARATE FILE, AND WHY `.js`. `app.config.js` runs in plain Node at
// config time and cannot import a `.ts` module; `src/services/supabase.ts` runs
// in Hermes through Metro. A CommonJS `.js` module is the one shape BOTH can
// read, so the value keeps exactly ONE owner (Constitution rule 2) while
// becoming visible to the config layer. Duplicating the literal into
// `app.config.js` would have been three characters shorter and would have
// created the second owner this file exists to prevent.
//
// WHY NOT `EXPO_PUBLIC_SUPABASE_URL` IN `eas.json`. Explicitly rejected on
// #1594: it introduces a second source of truth for a value this app
// deliberately keeps as one constant, and a config-shaped failure that only
// appears in a real build is the class that bricked the business app in #990.
//
// WHY THE CONFIG EMISSION TAKES NO `process.env` OVERRIDE. See `app.config.js`.
// An override could let `extra` and the runtime Supabase client disagree about
// which project they are talking to — precisely the two-truths state this file
// removes.
//
// The URL is public by design (it is the anon REST/Functions host and already
// ships in every client bundle on every surface). It is not a secret.

/** @type {{ SUPABASE_URL: string }} */
module.exports = {
  SUPABASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
};
