/**
 * A minimal ESM resolver so a gate can IMPORT AND RUN real app source.
 * Issue #1605 P1-6.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `issue_1605_expanded_card_one_spine.test.mjs` rule (a) is "CALL the real
 * function and check the number it returns". Node 22 strips TypeScript types
 * natively, so `expandedCardFacts.ts` is already runnable — but its imports are
 * EXTENSIONLESS (`'../utils/formatters'`), which Node's ESM resolver does not
 * complete, and one transitive dependency reaches `src/i18n`, which pulls
 * i18next and the React Native runtime into a bare `node --test` process.
 *
 * The alternatives were both worse. Restating the producer's arithmetic in the
 * test is the vacuity this file's header forbids — a rule that agrees with
 * itself. Slicing the function out of source and `new Function`-ing it cannot
 * parse the type annotations. So the gate resolves the real module graph
 * instead, with exactly two hooks:
 *
 *   1. an extensionless RELATIVE specifier gets `.ts` / `.tsx` / `/index.ts`
 *      appended — the resolution the bundler already performs;
 *   2. `src/i18n` resolves to a stub, because it is the ONLY leaf that needs
 *      the app runtime and nothing under test reads anything from it beyond a
 *      locale string.
 *
 * NOTHING ELSE IS STUBBED. `formatters`, `priceTiers`, `categoryUtils`,
 * `currencyService` and `localeUtils` are the real modules, so a gate that
 * imports through here is running product code, not a model of it. If a future
 * change makes the producer reach further into the runtime, ADD THE DEPENDENCY
 * TO THE GATE'S RUNNER rather than stubbing it here — a stub that grows is a
 * gate that quietly stops testing anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js'];

/** The one module replaced by a stub, and the stub's source. */
const I18N_SUFFIX = '/src/i18n';
const I18N_STUB =
  'const i18n = { language: "en", t: (k) => k, changeLanguage: () => {} };\n'
  + 'export default i18n;\n'
  + 'export const t = (k) => k;\n';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL !== undefined) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const base = path.resolve(parentDir, specifier);
    if (base.endsWith(I18N_SUFFIX)) {
      return { url: `${pathToFileURL(base).href}.i18n-stub`, shortCircuit: true, format: 'module' };
    }
    if (!fs.existsSync(base) || fs.statSync(base).isDirectory()) {
      for (const ext of EXTENSIONS) {
        const candidate = `${base}${ext}`;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.i18n-stub')) {
    return { format: 'module', source: I18N_STUB, shortCircuit: true };
  }
  return nextLoad(url, context);
}
