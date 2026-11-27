'use client'

// #4636 — inside /site-preview/<token> a page is drawn away from its own
// address. Layout pieces that choose their frame from the address
// (route-frame.tsx) read the previewed page's real address from here; on the
// live site there is no provider and they read the URL as before.
import { createContext, useContext, type ReactNode } from 'react'

const PreviewPath = createContext<string | null>(null)

export function PreviewPathProvider({ path, children }: { path: string; children: ReactNode }) {
  return <PreviewPath.Provider value={path}>{children}</PreviewPath.Provider>
}

export function usePreviewPath(): string | null {
  return useContext(PreviewPath)
}
