/** #1615 stage-3 implementor happy path. FAILS-ON-REVERT: reverting the media
 * selector removes the tested video→GIF→photo→coverless priority contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharing = require('..');
const storage = (name) => `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share/${name}`;

test('M1 eligible authored video wins and owns its real poster', () => {
  const selected = sharing.selectPublicMediaIdentity({
    video: { url: storage('cover.mp4'), posterUrl: storage('poster.jpg'), authored: true, publicSafe: true },
    animated: { url: 'https://media.giphy.com/cover.gif', posterUrl: storage('gif-poster.jpg'), publicSafe: true },
    photo: { url: storage('photo.jpg'), publicSafe: true },
  });
  assert.deepEqual(selected, { kind: 'video', url: storage('cover.mp4'), posterUrl: storage('poster.jpg') });
});

test('M2 GIF then photo then coverless degradation is deterministic', () => {
  const gif = { url: 'https://media.giphy.com/cover.gif', posterUrl: storage('gif-poster.jpg'), publicSafe: true };
  const photo = { url: storage('photo.jpg'), publicSafe: true };
  assert.equal(sharing.selectPublicMediaIdentity({ animated: gif, photo }).kind, 'gif');
  assert.equal(sharing.selectPublicMediaIdentity({ photo }).kind, 'photo');
  assert.equal(sharing.selectPublicMediaIdentity({}), null);
});

test('M3 moving media without a public poster and arbitrary HTTPS hosts fail closed', () => {
  assert.equal(sharing.selectPublicMediaIdentity({ video: { url: storage('cover.mp4'), authored: true, publicSafe: true } }), null);
  assert.equal(sharing.selectPublicMediaIdentity({ photo: { url: 'https://attacker.example/photo.jpg', publicSafe: true } }), null);
  assert.equal(sharing.selectPublicMediaIdentity({ photo: { url: storage('photo.jpg'), publicSafe: false } }), null);
});
