// #4452 rework 1 — the DOM rules every pop-up shares (the site's PopupHost and
// the draft preview's PreviewPopup), kept free of React so node tests can
// drive them with a small fake document.
//
// P1-5: the privacy panel is always in the DOM (hidden until the visitor opens
// it), so a pop-up may only hold back while that panel is actually OPEN.
// P0-2: the bot trap (.fk-hp) is never focusable and never the first field, so
// a keyboard visitor's typing always lands in a real field.

/** Minimal element surface the helpers read (real Elements satisfy it). */
export interface DomEl {
  hidden?: boolean
  getAttribute(name: string): string | null
  closest?(selector: string): DomEl | null
  getClientRects?(): { length: number }
}

export interface DomRoot {
  querySelectorAll(selector: string): ArrayLike<DomEl>
}

/** True only while the privacy panel is open and on screen. */
export function privacySheetOpen(doc: DomRoot): boolean {
  const sheets = Array.from(doc.querySelectorAll('.mpb'))
  return sheets.some((el) => {
    if (el.hidden === true || el.getAttribute('hidden') !== null) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false
    return true
  })
}

/**
 * The first real answer control, in document order: inside the field list only
 * (the bot trap sits outside it), never a tabindex=-1 control.
 */
export const FIRST_FIELD_SELECTOR = [
  '.fk-fields input:not([type="hidden"]):not([tabindex="-1"]):not([disabled])',
  '.fk-fields textarea:not([tabindex="-1"]):not([disabled])',
  '.fk-fields button:not([tabindex="-1"]):not([disabled])',
].join(',')

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]'

/** True when keyboard focus may land on this element (never the bot trap). */
export function keyboardFocusable(el: DomEl): boolean {
  const tab = el.getAttribute('tabindex')
  if (tab !== null && Number(tab) < 0) return false
  if (el.closest?.('[aria-hidden="true"]')) return false
  if (el.closest?.('.fk-hp')) return false
  return true
}

/** The dialog's tab order for the focus trap. */
export function focusablesIn<T extends DomEl>(root: { querySelectorAll(selector: string): ArrayLike<T> }): T[] {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(keyboardFocusable)
}
