// ORCH-1381 ADDENDUM D-B [business-getapp-android-choice] — the SINGLE owner of
// "open an external destination in a new tab".
//
// WHY THIS MODULE EXISTS. The pattern below was copy-pasted across FOUR call sites
// (nav explorer, nav business, /links, organiser hero) and every one of them
// carried the identical bug:
//
//     const win = window.open(dest, '_blank', 'noopener,noreferrer')
//     if (!win) window.location.assign(dest)   // "popup-blocked fallback"
//
// Per the HTML spec, `noopener` (and `noreferrer`, which IMPLIES `noopener`) force
// window.open to return `null` **even on success**. So `!win` was ALWAYS true: the
// "fallback" fired on every single tap. A new tab opened AND the current tab
// navigated away — the marketing page was destroyed on every CTA click, and
// ORCH-1328's own "/links stays mounted" contract was violated in production.
//
// THE TRAP (browser-verified, ORCH-1381 ADDENDUM C-4): `noreferrer` ALONE also
// returns null. Dropping only `noopener` while keeping `noreferrer` reproduces this
// bug EXACTLY, with no visible difference. BOTH tokens must stay absent.
//
// SECURITY. Dropping `noopener` does not lose its security property: `win.opener =
// null` severs the reference synchronously — before any script in the popup can
// run — so reverse tabnabbing is still impossible. Verified safe cross-origin (the
// write does not throw).
//
// REFERRER (ORCH-1381 OQ-2, ruled by Seth 2026-07-15). Dropping `noreferrer` means
// the `Referer` header now reaches the destination. ACCEPTED: these are Mingla's
// OWN store listings, the header carries no PII, and it is useful attribution
// signal. The property that actually matters — the store tab must never touch our
// page — is preserved by nulling `opener` above.
//
// React-free and pure, so the plain tsc+node test can exercise it with a fake
// Window (the marketing package has no jsdom/RTL runner).

/**
 * Open `dest` in a new tab, severing the opener reference, and fall back to a
 * same-tab navigation ONLY when the popup was genuinely blocked.
 *
 * @param dest Absolute or app-relative destination URL.
 * @param w    Injectable window — defaults to the real one. The injection point is
 *             what makes this behaviourally testable with no DOM test infra.
 */
export function openExternal(dest: string, w: Window = window): void {
  // NO 'noopener' / 'noreferrer' feature string — either one makes open() return
  // null even on success, which would fire the fallback unconditionally and
  // double-navigate. See the module docblock.
  const win = w.open(dest, '_blank')
  if (win) {
    // Preserve the noopener SECURITY property without the null-return side effect.
    win.opener = null
  } else {
    // Genuine popup block → no silent failure, no dead tap.
    w.location.assign(dest)
  }
}
