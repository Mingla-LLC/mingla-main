// #4452 §7.6 — the page editor's preview channel. Admin's Website pages editor
// shows the real page in an iframe of /site-preview/<token>?editor=1&ao=<Admin
// origin>; the page then draws "Add here" markers and posts spot, hero and block
// clicks to Admin. Messages go ONLY to an allowlisted Admin origin, and the
// page acts on messages ONLY from it (both sides check). Pure, unit tested.

// #4636 (investigation F-5 / D-2): only origins that may also FRAME the preview
// (SITE_PREVIEW_FRAME_ANCESTORS in next.config.ts). The vercel.app Admin
// previews were accepted here but refused by frame-ancestors, so they are gone;
// a test keeps the two lists in step (lib/__tests__/issue-4636-preview-editor.implementor.test.mjs).
export const ADMIN_ORIGINS: readonly RegExp[] = [
  /^https:\/\/admin\.usemingla\.com$/,
  /^http:\/\/localhost:\d{2,5}$/,
  /^http:\/\/127\.0\.0\.1:\d{2,5}$/,
]

/** The Admin origin to talk to, or null when the given one is not an Admin origin. */
export function editorOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 120) return null
  return ADMIN_ORIGINS.some((re) => re.test(raw)) ? raw : null
}

export type EditorMessage =
  | { type: 'editor-ready'; page: string }
  | { type: 'spot-click'; page: string; spot: string }
  | { type: 'hero-click'; page: string }
  | { type: 'block-click'; page: string; spot: string; block: string }
  | { type: 'editor-scroll'; page: string; y: number }

/** A message from the page is well formed (Admin checks this, and the origin, before acting). */
export function isEditorMessage(data: unknown): data is EditorMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  const id = (v: unknown) => typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v)
  switch (d.type) {
    case 'editor-ready':
    case 'hero-click':
      return id(d.page)
    case 'spot-click':
      return id(d.page) && id(d.spot)
    case 'block-click':
      return id(d.page) && id(d.spot) && typeof d.block === 'string' && /^[0-9a-f-]{36}$/.test(d.block)
    case 'editor-scroll':
      return id(d.page) && typeof d.y === 'number' && Number.isFinite(d.y) && d.y >= 0
    default:
      return false
  }
}
