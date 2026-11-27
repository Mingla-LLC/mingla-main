'use client'

// #4452 — the site blocks and the editor markers load as their own chunks, so a
// page's first-load JavaScript stays inside the #4339 speed budget whether or
// not it shows a block. React.lazy avoids next/dynamic's loader runtime; the
// local boundary keeps a block's chunk delay from replacing the whole page.
import { lazy, Suspense, type ComponentType } from 'react'

function deferred<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  const Component = lazy(() => load().then((resolved) => ({ default: resolved })))
  return function Deferred(props: Props) {
    return <Suspense fallback={null}><Component {...props} /></Suspense>
  }
}

export const LazyFormBlock = deferred(() => import('./form-block').then((m) => m.FormBlock))
export const LazyAddHere = deferred(() => import('./editor-bridge').then((m) => m.AddHere))
export const LazyBlockOutline = deferred(() => import('./editor-bridge').then((m) => m.BlockOutline))
export const LazyHeroOutline = deferred(() => import('./editor-bridge').then((m) => m.HeroOutline))
export const LazyButtonRow = deferred(() => import('./button-row').then((m) => m.ButtonRow))
export const LazyBannerBlock = deferred(() => import('./banner').then((m) => m.BannerBlock))
