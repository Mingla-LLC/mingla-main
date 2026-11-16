// #4452 §2.4 — a "Pop-up form" button opens the page's pop-up (button-only trigger).
export const POPUP_OPEN_EVENT = 'mingla:popup-open'
export function openSitePopup(opener: HTMLElement | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(POPUP_OPEN_EVENT, { detail: { opener } }))
}
