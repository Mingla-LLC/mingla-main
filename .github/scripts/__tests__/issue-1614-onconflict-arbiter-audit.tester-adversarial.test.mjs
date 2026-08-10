import assert from "node:assert/strict";
import test from "node:test";

import {
  enumerateSource,
  manifestFor,
} from "../issue-1614-onconflict-arbiter-audit.mjs";

test("finds executable targets hidden inside template interpolation", () => {
  const sites = enumerateSource(
    "const receipt = `${db.from('template_target').upsert({}, { onConflict: 'tenant,id' })}`;",
    "template-expression.ts",
  );
  assert.deepEqual(sites, [{
    table: "template_target",
    columns: ["tenant", "id"],
    file: "template-expression.ts",
    line: 1,
  }]);
});

test("decodes escaped literal property keys to their JavaScript value", () => {
  const sites = enumerateSource(`
    db.from("unicode_key").upsert({}, { ["on\\u0043onflict"]: "id" });
    db.from("hex_key").upsert({}, { ["on\\x43onflict"]: "tenant,id" });
  `, "escaped-keys.ts");
  assert.deepEqual(
    manifestFor(sites).map(({ table, columns }) => ({ table, columns })),
    [
      { table: "hex_key", columns: ["tenant", "id"] },
      { table: "unicode_key", columns: ["id"] },
    ],
  );
});

test("ignores misleading regular-expression contents", () => {
  assert.deepEqual(
    enumerateSource(
      String.raw`const example = /\{"onConflict":"id"\}/;`,
      "regex-literal.ts",
    ),
    [],
  );
});
