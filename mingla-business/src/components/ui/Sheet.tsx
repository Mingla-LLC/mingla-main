/**
 * Sheet — native entry point for the canonical bottom-sheet primitive.
 *
 * The implementation lives in `SheetMobile.tsx` (a platform-neutral filename),
 * NOT here. This indirection exists because of `Sheet.web.tsx`:
 *
 * On web, Metro platform-resolves the bare specifier "./Sheet" to
 * `Sheet.web.tsx`. So when `Sheet.web.tsx` delegated narrow web (< 1024px) to
 * the bottom-sheet via `import { Sheet } from "./Sheet"`, it imported ITSELF and
 * rendered itself recursively with no base case — an unbounded fiber tree that
 * OOM-killed the mobile-web renderer on every public page that mounts a Sheet
 * (ORCH-0964: the "page won't load / blank / needs multiple reloads" crash).
 *
 * Keeping the implementation in the neutral `./SheetMobile` lets `Sheet.web.tsx`
 * import the real bottom sheet for narrow web without the self-collision, while
 * native (iOS/Android) resolves "./Sheet" to this file and gets the bottom
 * sheet directly via the re-export below.
 */

export { Sheet, default } from "./SheetMobile";
export type {
  SheetProps,
  SheetSnapPoint,
  SheetSnapValue,
} from "./SheetMobile";
