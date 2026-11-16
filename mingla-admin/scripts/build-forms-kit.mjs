// #4452 §7.4 — build the forms kit into public/forms-kit/ (forms-kit.js and
// forms-kit.css) from the marketing site's REAL field kit
// (mingla-marketing/components/forms), so the builder's live preview is what
// visitors get. Runs before `vite build` / `vite` (package.json pre-scripts).
// Uses esbuild, which Vite already ships (no new dependency). React resolves
// from mingla-admin/node_modules, so the marketing app's packages are not
// needed. The kit never calls the network: analytics, pixels and the
// growth-tools transport are replaced by no-ops, and every form is a preview.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(HERE, "..");
const MARKETING = path.resolve(ADMIN, "..", "mingla-marketing");
const OUT = path.join(ADMIN, "public", "forms-kit");
const NM = path.join(ADMIN, "node_modules");

const STUBS = {
  "@/components/marketing/marketing-capture": "export function captureMarketing() {} export function isMarketingAnalyticsOn() { return false } export function isMarketingAdsOn() { return false }",
  "@/lib/marketing-pixels": "export function fireMarketingLead() {}",
  "@/lib/growth-tools-transport": "export async function postGrowthTools() { throw new Error('preview') }",
  "next/navigation": "export function usePathname() { return '/' } export function useRouter() { return { push() {}, replace() {} } }",
};

const stubPlugin = {
  name: "forms-kit-stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (Object.hasOwn(STUBS, args.path)) return { path: args.path, namespace: "kit-stub" };
      if (args.path.startsWith("@/")) {
        const base = path.join(MARKETING, args.path.slice(2));
        for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
        }
      }
      return undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "kit-stub" }, (args) => ({ contents: STUBS[args.path], loader: "ts" }));
  },
};

fs.mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: { "forms-kit": path.join(MARKETING, "components/forms/kit/forms-kit-entry.tsx") },
  bundle: true,
  outdir: OUT,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  loader: { ".css": "css" },
  inject: [],
  plugins: [stubPlugin],
  // React and react-dom always come from mingla-admin, one copy each.
  alias: { react: path.join(NM, "react"), "react-dom": path.join(NM, "react-dom") },
  nodePaths: [NM],
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""' },
  logLevel: "warning",
});
// The page around the pop-up.
fs.appendFileSync(path.join(OUT, "forms-kit.css"), fs.readFileSync(path.join(MARKETING, "components/forms/kit/kit.css"), "utf8"));
fs.writeFileSync(path.join(OUT, ".gitignore"), "*\n!.gitignore\n");
console.log(`[forms-kit] built ${path.relative(ADMIN, OUT)}/forms-kit.js and forms-kit.css`);
