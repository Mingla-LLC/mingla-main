/**
 * #4490 venue owners — a JEST-ONLY stand-in for the two owner barrels
 * (src/components/venue/host/venueHostScreens.ts and
 * src/components/venue/guest/venueGuestScreens.ts).
 *
 * In the app, each owner is ONE web chunk: loading it is the point. Under jest,
 * the real barrel would evaluate every Host screen (the Till, Kitchen and bar,
 * the offer editors…) the moment a render suite opens ONE module, including
 * module-scope native imports those suites never mock. This stand-in reads the
 * real barrel's `export { … } from "…"` lines and defines a lazy getter per
 * name, so a suite loads only the screens it actually opens, and every per-path
 * `jest.mock` in the suite still applies. It cannot drift: the names and paths
 * come from the real barrel.
 */
const fs = require("fs");
const path = require("path");

function lazyOwner(barrel) {
  const dir = path.dirname(barrel);
  const src = fs.readFileSync(barrel, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const out = {};
  Object.defineProperty(out, "__esModule", { value: true });
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const spec = m[2];
    const target = spec.startsWith(".") ? path.resolve(dir, spec) : spec;
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (part.length === 0 || part.startsWith("type ")) continue;
      const [name, alias] = part.split(/\s+as\s+/);
      Object.defineProperty(out, alias ?? name, {
        enumerable: true,
        get: () => require(target)[name],
      });
    }
  }
  return out;
}

module.exports = { lazyOwner };
