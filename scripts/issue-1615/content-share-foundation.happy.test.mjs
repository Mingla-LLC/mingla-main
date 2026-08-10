/**
 * #1615 implementor stage-2 happy path — new append-only suite.
 * FAILS-ON-REVERT: reverting the forward migration or authoritative mapper
 * makes H1–H7 fail while the legacy /p assertions remain green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const sharing = require(path.join(ROOT, 'packages/sharing'));
const migrationPath = 'supabase/migrations/20270226001615_issue_1615_content_share_links.sql';
const migration = read(migrationPath);

test('H1 migration is strictly forward and leaves the live legacy table intact', () => {
  assert.ok(fs.existsSync(path.join(ROOT, migrationPath)));
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase/migrations/20270225001615_issue_1615_public_share_snapshots.sql')));
  assert.doesNotMatch(migration, /(?:DROP|ALTER)\s+TABLE\s+public\.shared_card_snapshots/i);
  assert.match(migration, /FROM public\.shared_card_snapshots/);
  assert.match(migration, /'legacy_snapshot'/);
});

test('H2 private forced-RLS link, immutable version and alias tables are executable SQL contracts', () => {
  for (const table of ['content_share_links', 'content_share_versions', 'content_share_aliases']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /REVOKE ALL ON public\.content_share_links, public\.content_share_versions, public\.content_share_aliases\s+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /content_share_versions rows are immutable/);
});

test('H3 codes are 16-character case-sensitive Base62 from cryptographic bytes', () => {
  assert.match(migration, /extensions\.gen_random_bytes\(16\)/);
  assert.match(migration, /0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/);
  assert.match(migration, /short_code text COLLATE "C"/);
  assert.match(migration, /short_code ~ '\^\[0-9A-Za-z\]\{16\}\$'/);
  assert.match(migration, /short_code_collision_exhausted/);
});

test('H4 same principal/entity/policy/source is stable and material fingerprint advances an immutable version', () => {
  assert.match(migration, /content_share_links_stable_active_source_idx/);
  assert.match(migration, /COALESCE\(creator_principal/);
  assert.match(migration, /v_link\.current_version \+ 1/);
  assert.match(migration, /p_facts::text \|\| '\|' \|\| COALESCE\(p_media_identity/);
  assert.doesNotMatch(migration.match(/v_fingerprint :=[\s\S]*?'sha256'/)?.[0] || '', /p_attribution/);
});

test('H5 authoritative mapper emits valid ShareFactsV1 for all eight kinds', async () => {
  const mapper = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/contentShare.ts')));
  const brand = { name: 'Mingla Host', slug: 'mingla-host' };
  const eventRow = { id: 'event-id', title: 'Night Out', slug: 'night-out', location_text: 'The Yard', timezone: 'America/New_York', status: 'scheduled', brands: brand };
  const fixtures = {
    place: { row: { name: 'Namu', google_place_id: 'public-place', city: 'Durham', primary_type: 'restaurant', rating: 4.6 } },
    curated: { row: { title: 'My Plan', card_data: { stops: [{ title: 'One' }, { title: 'Two' }], city: 'Durham' } } },
    event: { row: eventRow, date: { start_at: '2026-08-09T00:00:00Z' }, tickets: [{ price_cents: 2500, currency: 'USD' }] },
    rsvp_event: { row: eventRow, date: { start_at: '2026-08-09T00:00:00Z' }, tickets: [] },
    trip: { row: { ...eventRow, destination_text: 'Asheville' }, tickets: [{ price_cents: 39900, currency: 'USD' }] },
    experience: { row: eventRow, date: { start_at: '2026-08-09T00:00:00Z' }, tickets: [{ price_cents: 4500, currency: 'USD' }] },
    venue: { row: { id: 'venue-id', brand_slug: 'mingla-host', slug: 'the-yard', name: 'The Yard', city: 'Durham', venue_category: 'creative_and_arts' } },
    brand: { row: brand, upcomingCount: 3 },
  };
  for (const kind of sharing.SHARE_ENTITY_KINDS) {
    const mapped = mapper.mapAuthoritativeShareFacts(kind, fixtures[kind]);
    const validated = sharing.validateShareFactsV1(mapped.facts);
    assert.equal(validated.ok, true, `${kind}: ${JSON.stringify(validated)}`);
    assert.equal(mapped.destinationManifest.kind, kind);
  }
});

// [TEST-MOD-APPROVED #1615] Stage 6 adds the sanctioned null-principal public lane;
// H6 still pins identity-only authoritative mapping and the single mint RPC.
test('H6 edge creation takes identity only, loads served truth and calls the sole mint RPC', () => {
  const edge = read('supabase/functions/shared-card/index.ts');
  const service = read('supabase/functions/_shared/contentShareService.ts');
  assert.match(edge, /raw\?\.contract === "content_share_v1"/);
  assert.match(edge, /createContentShareV1\(db, user\?\.id \|\| null, raw, \{ serverCreated \}\)/);
  assert.match(service, /loadAuthoritativeContentShare\(db, userId \|\| "", requestedKind/);
  assert.match(service, /rpc\("upsert_content_share_version"/);
  const block = service;
  for (const untrusted of ['raw.title', 'raw.cover', 'raw.price', 'raw.hours', 'raw.destination']) assert.doesNotMatch(block, new RegExp(untrusted.replace('.', '\\.')));
  assert.match(edge, /resolveRuntimeBoolean\(/);
  assert.match(edge, /"content_share_v1_create_enabled"/);
  assert.match(edge, /"CONTENT_SHARE_V1_CREATE_ENABLED"/);
  assert.doesNotMatch(edge, /Deno\.env\.get\("CONTENT_SHARE_V1_CREATE_ENABLED"\)/);
});

test('H7 later stages add receivers without mutating the stage-2 migration contract', () => {
  // [TEST-MOD-APPROVED #1615] The branch has intentionally advanced beyond
  // dependency stage 2; pinning absence now rejects the required receiver stage.
  assert.equal(fs.existsSync(path.join(ROOT, 'app-mobile/app/s/[code].tsx')), true);
  assert.match(read('mingla-business/vercel.json'), /"source": "\/s\/:code"/);
  assert.match(read('mingla-marketing/vercel.json'), /"source": "\/s\/:code"/);
});
