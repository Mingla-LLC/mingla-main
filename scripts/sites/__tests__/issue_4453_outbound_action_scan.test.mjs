// #4453 PR 2 (booking lock) — the read-only stored-link scan: it reads every
// stored action field the catalogue names (saved pages, latest drafts, the
// header button), judges each with the contracts' own rule, and reports the
// link's host only.
import assert from "node:assert/strict";
import test from "node:test";
import { actionColumns, judgeRows, scanSql } from "../scan-outbound-action-links.mjs";

test("#4453 the scan covers every action field in the catalogue, and only those", () => {
  const fields = actionColumns().map(([type, list, column]) => `${type}.${list ? `${list}[].` : ""}${column}`);
  for (const expected of ["hero.ctas[].href", "cta.href", "menu_link.href", "contact_handoff.href", "offering_grid.cta_href", "offering_grid.empty_cta_href", "testimonials.cta_href", "offering_history.cta_href", "video_feature.group_cta_href"]) {
    assert.ok(fields.includes(expected), expected);
  }
  assert.ok(!fields.includes("hours_location.map_url"));
  assert.ok(!fields.includes("map_embed.directions_url"));
});

test("#4453 the scan query only reads", () => {
  const sql = scanSql();
  assert.match(sql, /^SELECT /);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i);
  assert.match(sql, /sites_cms\._pages_v_blocks_cta b/);
  assert.match(sql, /p\.latest IS TRUE/);
  assert.match(sql, /header_cta_target_type = 'url'/);
});

test("#4453 outside buttons are counted per site, with the host only", () => {
  const result = judgeRows([
    { site_id: "s1", page: "", block: "cta", field: "href", href: "https://www.opentable.com/r/secret-path?token=x" },
    { site_id: "s1", page: "menu", block: "menu_link", field: "href", href: "https://host.usemingla.com/b/gogi" },
    { site_id: "s2", page: "about", block: "contact_handoff", field: "href", href: "https://wa.me/234000" },
    { site_id: "s2", page: "", block: "hero", field: "ctas[].href", href: "/trips" },
  ]);
  assert.equal(result.scanned, 4);
  assert.deepEqual(result.perSite, { s1: 1, s2: 1 });
  assert.deepEqual(result.failing.map((row) => `${row.site_id}:${row.block}:${row.problem}:${row.host}`), [
    "s1:cta:outside_mingla:www.opentable.com",
    "s2:contact_handoff:outside_mingla:wa.me",
  ]);
  assert.ok(!JSON.stringify(result).includes("secret-path"));
});
