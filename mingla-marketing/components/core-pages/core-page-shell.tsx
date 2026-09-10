import type { ReactNode } from 'react'
import { CutoutFooter, CutoutNav, CutoutShell, type CutoutSurface } from '@/components/cutout'

export function CorePageShell({ children, surface = 'explorer', dark = false }: {
  readonly children: ReactNode
  readonly surface?: CutoutSurface
  readonly dark?: boolean
}) {
  return (
    <CutoutShell dark={dark}>
      <CutoutNav surface={surface} homeHref="/" />
      <main id="main" className="core-main">{children}</main>
      <CutoutFooter surface={surface} />
    </CutoutShell>
  )
}
