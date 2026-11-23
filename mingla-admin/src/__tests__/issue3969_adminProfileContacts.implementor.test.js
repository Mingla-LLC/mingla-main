// Issue #3969 Step 2 — the admin console reads people's emails through the
// admin contacts read, never from the profile row.
//
// FAILS-ON-REVERT: putting `email` back into a profiles select in the command
// palette, the coach-mark reset, the identity read, the product board's
// reporters or the Email page's preferences list fails here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chunkIds,
  fetchContactsInChunks,
  pickSingleContactByEmail,
} from "../lib/profileContactsPure.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) =>
  fs.readFileSync(path.join(here, "..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SITES = [
  "components/CommandPalette.jsx",
  "pages/SettingsPage.jsx",
  "services/identityReadService.js",
  "services/productAvengersService.js",
  "pages/EmailPage.jsx",
];

describe("#3969 admin profile contacts", () => {
  it("the service calls the admin contacts read and throws on failure", () => {
    const source = read("services/adminProfileContactsService.js");
    assert.match(source, /supabase\.rpc\("issue_3969_admin_profile_contacts", \{/);
    assert.match(source, /p_user_ids:/);
    assert.match(source, /p_email:/);
    assert.match(source, /if \(error\) throw error;/);
  });

  for (const site of SITES) {
    it(`${site} reads no email from profiles`, () => {
      const source = read(site);
      const chains = source.match(/\.from\(\s*["']profiles["']\s*\)[\s\S]{0,200}/g) || [];
      for (const chain of chains) {
        const select = /\.select\(\s*["'`]([^"'`]*)["'`]/.exec(chain);
        if (select) assert.doesNotMatch(select[1], /\bemail\b|\*/, `${site}: ${select[1]}`);
      }
      assert.doesNotMatch(source, /profiles![\w]+\([^)]*\bemail\b/, `${site}: profiles embed names email`);
      assert.ok(
        /adminProfileContactsService|issue_3969_admin_profile_contacts/.test(source),
        `${site} uses the admin contacts read`,
      );
    });
  }

  it("the coach-mark reset finds the person by email through the admin read", () => {
    const source = read("pages/SettingsPage.jsx");
    assert.match(source, /fetchAdminProfileContacts\(\{ email: userEmail\.trim\(\) \}\)/);
    assert.doesNotMatch(source, /\.eq\("email"/);
  });

  it("emails missing from the admin read are shown as empty, and the failure is logged", () => {
    for (const site of ["components/CommandPalette.jsx", "pages/EmailPage.jsx"]) {
      const source = read(site);
      assert.match(source, /contacts\[[\w.]+\]\?\.email \|\| null/, site);
      assert.match(source, /console\.warn\("\[\w+\] contact read failed:"/, site);
    }
  });
});

describe("#3969 admin contacts: batching and exact email match", () => {
  it("never sends more than 1000 ids in one call and merges every batch", async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => `id-${i}`);
    const sizes = [];
    const rows = await fetchContactsInChunks(ids, async (chunk) => {
      sizes.push(chunk.length);
      return chunk.map((id) => ({ id }));
    });
    assert.deepEqual(sizes, [1000, 1000, 500]);
    assert.equal(rows.length, 2500);
    assert.equal(chunkIds([]).length, 0);
  });

  it("a failing batch fails the whole read", async () => {
    await assert.rejects(
      fetchContactsInChunks(Array.from({ length: 1500 }, (_, i) => String(i)), async (chunk) => {
        if (chunk.length === 500) throw new Error("boom");
        return [];
      }),
      /boom/,
    );
  });

  it("the by-id read goes through the batching helper", () => {
    assert.match(read("services/adminProfileContactsService.js"), /fetchContactsInChunks\(/);
  });

  it("email match is case-insensitive and exact; none or several is refused", () => {
    const one = pickSingleContactByEmail([{ id: "a", email: "Sam@X.com" }], " sam@x.COM ");
    assert.equal(one.user.id, "a");
    assert.equal(pickSingleContactByEmail([], "a@b.c").error, "none");
    assert.equal(pickSingleContactByEmail([{ id: "a", email: "other@x.com" }], "a@b.c").error, "none");
    assert.equal(
      pickSingleContactByEmail(
        [{ id: "a", email: "sam@x.com" }, { id: "b", email: "SAM@x.com" }],
        "sam@x.com",
      ).error,
      "ambiguous",
    );
  });

  it("the coach-mark reset uses the exact-match picker", () => {
    assert.match(read("pages/SettingsPage.jsx"), /pickSingleContactByEmail\(rows, userEmail\)/);
  });
});
