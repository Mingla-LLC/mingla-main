/** #1615 stage-3 tester angle. FAILS-ON-REVERT: removing served media mapping or
 * reintroducing private job JSON makes this suite fail. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = path.join(ROOT, 'supabase/functions/_shared/contentShare.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const storage = (name) => `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share/${name}`;

test('MA1 authoritative reads include public cover/gallery/poster sources and exclude job payloads', () => {
  for (const field of ['cover_media_url', 'cover_media_type', 'cover_media_alt', 'cover_media_gallery', 'stored_photo_urls', 'pool_photo_urls', 'profile_photo_url']) assert.match(source, new RegExp(field));
  for (const forbidden of ['event_cover_video_jobs', 'provider_payload', 'provider_response', 'raw_google_data']) assert.doesNotMatch(source, new RegExp(forbidden));
});

test('MA2 served event video uses gallery photo as immutable public poster', async () => {
  const mapper = await import(pathToFileURL(sourcePath));
  const media = mapper.mapServedMediaIdentity({
    title: 'Video event', cover_media_type: 'video', cover_media_url: storage('cover.mp4'),
    cover_media_gallery: [{ url: storage('poster.jpg'), type: 'image' }], cover_media_alt: 'Crowd dancing',
  });
  assert.deepEqual(media, { kind: 'video', url: storage('cover.mp4'), posterUrl: storage('poster.jpg'), alt: 'Crowd dancing' });
});

test('MA3 no poster, private URL, and unsupported provider become truthful coverless', async () => {
  const mapper = await import(pathToFileURL(sourcePath));
  assert.equal(mapper.mapServedMediaIdentity({ cover_media_type: 'video', cover_media_url: storage('cover.mp4') }), null);
  assert.equal(mapper.mapServedMediaIdentity({ cover_media_type: 'image', cover_media_url: 'http://private.test/a.jpg' }), null);
  assert.equal(mapper.mapServedMediaIdentity({ cover_media_type: 'image', cover_media_url: 'https://attacker.example/a.jpg' }), null);
});

test('MA4 media is version-owned and participates in material fingerprinting', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270226001615_issue_1615_content_share_links.sql'), 'utf8');
  const service = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/contentShareService.ts'), 'utf8');
  assert.match(migration, /media_identity jsonb/);
  assert.match(migration, /COALESCE\(p_media_identity, 'null'::jsonb\)::text/);
  assert.match(service, /p_media_identity: mapped\.mediaIdentity \|\| null/);
});
