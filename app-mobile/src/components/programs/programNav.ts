/**
 * #3872 — where Back and Continue go on the Creator and Local screens.
 *
 * Setup steps always return to the setup checklist: Back dismisses to it (or
 * replaces the step with it when the step was opened from a link or the status
 * screen), and Continue pushes the next step so the checklist stays in history.
 * Replacing a step used to drop the checklist, so Back landed on the Profile tab.
 *
 * Pure on purpose (no imports): the unit suite runs it under node directly.
 */

export const SETUP_CHECKLIST_HREF = '/creator/setup';
export const CREATOR_HOME_HREF = '/creator';

const SETUP_STEP_KEYS = ['profile', 'rates', 'showcase', 'socials', 'payout', 'agreement'];

export type ProgramNav =
  | { kind: 'back' }
  | { kind: 'push'; href: string }
  | { kind: 'dismissTo'; href: string }
  | { kind: 'replace'; href: string };

function cleanPath(pathname: string | null | undefined): string {
  const path = (pathname ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  return path || '/';
}

/** "/creator/setup/profile" → true. */
export function isSetupStepPath(pathname: string | null | undefined): boolean {
  const match = /^\/creator\/setup\/([^/]+)$/.exec(cleanPath(pathname));
  return Boolean(match && SETUP_STEP_KEYS.includes(match[1]));
}

/** Where a screen goes when there is no history to go back to. */
export function programFallbackHref(pathname: string | null | undefined): string {
  const path = cleanPath(pathname);
  if (isSetupStepPath(path)) return SETUP_CHECKLIST_HREF;
  if (path.startsWith('/creator/')) return CREATOR_HOME_HREF;
  return '/';
}

/** What the header's Back does on this screen. */
export function programBackNav(pathname: string | null | undefined, canGoBack: boolean): ProgramNav {
  if (isSetupStepPath(pathname)) return { kind: 'dismissTo', href: SETUP_CHECKLIST_HREF };
  if (canGoBack) return { kind: 'back' };
  return { kind: 'replace', href: programFallbackHref(pathname) };
}

/** After a setup step saves: push the next open step, or go back to the checklist. */
export function nextSetupNav(nextStep: string | null | undefined): ProgramNav {
  if (nextStep && SETUP_STEP_KEYS.includes(nextStep)) return { kind: 'push', href: `${SETUP_CHECKLIST_HREF}/${nextStep}` };
  return { kind: 'dismissTo', href: SETUP_CHECKLIST_HREF };
}

type RouterLike = {
  back: () => void;
  push: (href: never) => void;
  replace: (href: never) => void;
  dismissTo?: (href: never) => void;
};

/** Runs a ProgramNav on an expo-router router. */
export function runProgramNav(router: RouterLike, nav: ProgramNav): void {
  switch (nav.kind) {
    case 'back': router.back(); return;
    case 'push': router.push(nav.href as never); return;
    case 'replace': router.replace(nav.href as never); return;
    case 'dismissTo':
      if (typeof router.dismissTo === 'function') router.dismissTo(nav.href as never);
      else router.replace(nav.href as never);
  }
}
