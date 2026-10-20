// Issue #3980 — Constitution rule 6: logout clears everything. Modules that
// remember answers outside React state (for example the Calendar's runway
// list) register a clear here; AuthContext runs every one whenever the signed-in
// person goes away (sign out, a rejected session, a session that ended).
const CLEARS = new Set();

export function onSignOut(clear) {
  CLEARS.add(clear);
  return () => CLEARS.delete(clear);
}

export function runSignOutCleanup() {
  for (const clear of CLEARS) {
    try { clear(); } catch (err) { console.error("[signOutCleanup] a clear failed:", err?.message || err); }
  }
}
