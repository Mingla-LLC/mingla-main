// MINGLA-INVARIANT: I-3697-CREATIVE-REUSE-SURVIVES-DRAFT-HASH | issue #3697 | Creative Library "Use in campaign" loads the chosen creative into a new Campaign Builder even after draft setup writes draft= into the URL
/**
 * Issue #3697 — "Use in campaign" opened an empty builder.
 *
 * Live evidence (2026-10-21, #3697 live check): Creative Library → "Use in
 * campaign" opened the Campaign Builder on Creative with no creative and no
 * error. Draft setup rewrites the hash to add `draft=` before the draft is
 * ready; the builder re-read the hash on every render, decided this was no
 * longer a new reuse, and never asked for the creative.
 *
 * The admin tree has no DOM library, so this runs the real page module through
 * Vite with React's hooks replaced by a small synchronous hook runner and the
 * network services faked. Effects, state updates and the hash rewrite all run
 * exactly as the page wrote them.
 *
 * Run: node --test src/__tests__/issue3697_creative_reuse_survives_draft_hash.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const PAGE = "/src/pages/CampaignBuilderPage.jsx";
const CREATIVE_ID = "35f08b54-45d5-480c-b0cf-3af7890ebac7";

const SERVICE_EXPORTS = [
  ...readFileSync(resolve(ADMIN_ROOT, "src/services/adEngineService.js"), "utf8")
    .matchAll(/^export (?:async )?(?:function|const) (\w+)/gm),
].map((m) => m[1]);

// ── Hook runner shared with the virtual modules through globalThis ──
function createHookRunner() {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let dirty = false;
  const depsChanged = (prev, next) =>
    !prev || !next || prev.length !== next.length ||
    next.some((dep, i) => !Object.is(dep, prev[i]));

  const runner = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) {
        slots[i] = { value: typeof initial === "function" ? initial() : initial };
        slots[i].set = (next) => {
          const value = typeof next === "function" ? next(slots[i].value) : next;
          if (!Object.is(value, slots[i].value)) {
            slots[i].value = value;
            dirty = true;
          }
        };
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!(i in slots) || depsChanged(slots[i].deps, deps)) {
        slots[i] = { value: factory(), deps };
      }
      return slots[i].value;
    },
    useCallback(fn, deps) {
      return runner.useMemo(() => fn, deps);
    },
    useEffect(effect, deps) {
      const i = cursor++;
      const prev = slots[i];
      if (!prev || depsChanged(prev.deps, deps)) {
        slots[i] = { deps, cleanup: prev?.cleanup };
        effects.push(() => {
          if (typeof slots[i].cleanup === "function") slots[i].cleanup();
          slots[i].cleanup = effect();
        });
      }
    },
    async mount(Component) {
      for (let pass = 0; pass < 200; pass += 1) {
        dirty = false;
        cursor = 0;
        effects.length = 0;
        Component();
        for (const run of effects.splice(0)) run();
        await new Promise((r) => setTimeout(r, 0));
        if (!dirty) return;
      }
      throw new Error("builder never settled");
    },
    unmount() {
      for (const slot of slots) {
        if (typeof slot?.cleanup === "function") slot.cleanup();
      }
    },
    slots,
  };
  return runner;
}

function installBrowserGlobals(hash) {
  const location = { hash, pathname: "/", search: "" };
  globalThis.window = {
    location,
    history: {
      state: null,
      replaceState(_state, _title, url) {
        const at = url.indexOf("#");
        location.hash = at >= 0 ? url.slice(at) : "";
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
  };
  return location;
}

let vite;

before(async () => {
  vite = await createServer({
    root: ADMIN_ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [
      {
        name: "issue3697-builder-fakes",
        enforce: "pre",
        // Vite externalises bare `react` in SSR before resolveId sees it, so
        // the page's own import lines are pointed at the fakes instead.
        transform(code, id) {
          if (!id.endsWith(PAGE)) return null;
          return code
            .replace(/from "react";/, 'from "\0fake-react";')
            .replace(/from "\.\.\/services\/adEngineService";/, 'from "\0fake-ad-engine";')
            .replace(/from "\.\.\/context\/ToastContext";/, 'from "\0fake-toast";')
            .replace(/from "\.\.\/lib\/featureFlags";/, 'from "\0fake-flags";');
        },
        resolveId(source) {
          return source.startsWith("\0fake-") ? source : null;
        },
        load(id) {
          if (id === "\0fake-react") {
            return ["useState", "useRef", "useMemo", "useCallback", "useEffect"]
              .map((name) =>
                `export const ${name} = (...a) => globalThis.__hooks.${name}(...a);`)
              .join("\n");
          }
          if (id === "\0fake-ad-engine") {
            return SERVICE_EXPORTS.map((name) =>
              `export const ${name} = (...a) => globalThis.__services.call(${JSON.stringify(name)}, a);`)
              .join("\n");
          }
          if (id === "\0fake-toast") {
            return "const t = { addToast: (x) => globalThis.__toasts.push(x) };\n" +
              "export const useToast = () => t;";
          }
          if (id === "\0fake-flags") {
            return "export const loadFeatureFlags = async () => ({});";
          }
          return null;
        },
      },
    ],
  });
});

after(async () => {
  await vite?.close();
  delete globalThis.window;
});

const REUSE_ROW = {
  id: CREATIVE_ID,
  kind: "image",
  name: "apex-beach-unwind-cover",
  source_url: "https://example.test/apex-1x1.jpg",
  storage_bucket: "ad-creatives",
  storage_path: "library/apex-1x1.jpg",
  poster_url: null,
  ai_generated: false,
  variants: {
    "1:1": { url: "https://example.test/apex-1x1.jpg" },
    "4:5": { url: "https://example.test/apex-4x5.jpg" },
    "9:16": { url: "https://example.test/apex-9x16.jpg" },
  },
};

describe("#3697 Creative Library → Use in campaign", () => {
  it("loads the creative after draft setup rewrites the hash", async () => {
    const location = installBrowserGlobals(
      `#/campaign-builder?step=creative&creative=${CREATIVE_ID}`,
    );
    const calls = [];
    globalThis.__toasts = [];
    globalThis.__services = {
      async call(name, args) {
        calls.push({ name, args });
        if (name === "parseEdgeError") return null;
        if (name === "getAdCreativeForReuse") {
          return { data: { creative: REUSE_ROW }, error: null };
        }
        if (name === "creativeUpload") {
          return { data: { validation: { ok: true } }, error: null };
        }
        if (name === "saveAdminAdPlanDraft") {
          return { data: { draft: { revision: 1 } }, error: null };
        }
        return { data: null, error: null };
      },
    };
    const hooks = createHookRunner();
    globalThis.__hooks = hooks;

    const { CampaignBuilderPage } = await vite.ssrLoadModule(PAGE);
    try {
      await hooks.mount(CampaignBuilderPage);
    } finally {
      hooks.unmount();
    }

    // Precondition: the bug's trigger happened — draft setup wrote draft=.
    assert.match(location.hash, /[?&]draft=[0-9a-f-]{36}/);
    assert.match(location.hash, new RegExp(`creative=${CREATIVE_ID}`));

    const reuse = calls.filter((c) => c.name === "getAdCreativeForReuse");
    assert.equal(reuse.length, 1, "the library creative is fetched exactly once");
    assert.equal(reuse[0].args[0], CREATIVE_ID);

    const creative = hooks.slots.find(
      (slot) => slot?.value?.creativeRow?.id === CREATIVE_ID,
    )?.value;
    assert.ok(creative, "the builder's creative state holds the library row");
    assert.deepEqual(Object.keys(creative.variants).sort(), ["1:1", "4:5", "9:16"]);
    assert.equal(creative.publicUrl, REUSE_ROW.source_url);
    assert.equal(creative.rightsConfirmed, false);
    assert.ok(
      globalThis.__toasts.some((t) => t.title === "Creative selected from the library"),
    );
    assert.ok(!globalThis.__toasts.some((t) => t.variant === "error"));
  });
});
