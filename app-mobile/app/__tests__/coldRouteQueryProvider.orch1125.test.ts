/**
 * ORCH-1125 [cold deep-link "No QueryClient set" crash] — cold-route render test.
 *
 * Harness note (no jest in app-mobile): this app has no jest/RTL installed
 * (confirmed: scripts run under Node's built-in test runner with type-stripping,
 * e.g. `node --experimental-strip-types --test`, wired via scripts/ci/*.mjs).
 * The SPEC §9(c) intent is a *cold-route render* that proves the "No QueryClient
 * set" crash is governed by provider PRESENCE, not by the fetch. A full
 * @testing-library/react-native render of the real `/t/[brandSlug]/[tripSlug]`
 * screen is not runnable here (RTL + react-test-renderer are not installed, and
 * the real screen pulls the whole native dependency graph). So this test renders
 * the *mechanism* the public-route screens rely on — a component whose first
 * `useQuery` runs OUTSIDE vs INSIDE a QueryClient provider — via react-dom/server
 * (`react-dom` IS present), which throws the identical React Query error in Node.
 *
 * Run:  node --experimental-strip-types --test app/__tests__/coldRouteQueryProvider.orch1125.test.ts
 *       (wrapper: `npm run test:orch-1125`)
 *
 * What it proves:
 *   1. A route component that calls useQuery, rendered with NO QueryClient
 *      provider above it (the cold-deep-link-to-sibling-route condition before
 *      the fix), throws exactly "No QueryClient set, use QueryClientProvider to
 *      set one" — the crash ORCH-1117's tester captured on a release build.
 *   2. The SAME component, wrapped by a QueryClientProvider (the
 *      post-fix root-layout condition where PersistQueryClientProvider wraps
 *      <Stack/> and therefore every route), renders without throwing.
 *
 * This is the fails-on-revert proof for the crash mechanism: if the provider is
 * not an ancestor of the route, the render throws. The *structural* fails-on-revert
 * (provider must be in _layout.tsx, not index.tsx) is additionally enforced by
 * scripts/ci/check-rq-provider-at-root-layout.sh + orch-1125-regression-check.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  useQuery,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

// Stand-in for a public deep-link route screen (e.g. trip detail at
// app/t/[brandSlug]/[tripSlug]): its first render calls useQuery for the anon
// slug fetch. `enabled: false` keeps the network out of it — we are testing
// provider presence, not the fetch, exactly per the SPEC.
function PublicRouteScreenProbe(): React.ReactElement {
  useQuery({
    queryKey: ['orch-1125', 'cold-route-probe'],
    queryFn: async () => 'never-runs',
    enabled: false,
  });
  return React.createElement('div', null, 'trip-detail-rendered');
}

test('cold deep-link route WITHOUT a QueryClient ancestor throws "No QueryClient set" (the ORCH-1125 crash)', () => {
  assert.throws(
    () => renderToStaticMarkup(React.createElement(PublicRouteScreenProbe)),
    /No QueryClient set/,
    'A route that runs useQuery outside a QueryClientProvider must throw "No QueryClient set" — this is the exact cold-deep-link crash the root-layout hoist fixes.',
  );
});

test('the SAME route wrapped by the QueryClient provider (root-layout condition) renders without throwing', () => {
  // Mirrors the post-fix tree: PersistQueryClientProvider (here a plain
  // QueryClientProvider with the singleton-equivalent client) wraps <Stack/> at
  // root, so the route inherits a client.
  const client = new QueryClient();
  let html = '';
  assert.doesNotThrow(() => {
    html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(PublicRouteScreenProbe),
      ),
    );
  });
  assert.match(
    html,
    /trip-detail-rendered/,
    'With a QueryClient ancestor the public route renders its content instead of crashing.',
  );
});
