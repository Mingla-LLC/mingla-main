'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import { AudienceMenuContent } from '@/components/cutout/audience-menu-content'
import { type CutoutSurface } from '@/components/cutout/device-cta'
import { SideMenu } from '@/components/ui/side-menu'

export function PageSystemNav({ surface }: { readonly surface: CutoutSurface }) {
  const [open, setOpen] = useState(false)
  const [childDialogOpen, setChildDialogOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <header className="ps-nav" data-print-hide>
        <div className="ps-nav-inner">
          <Link href="/" aria-label="Mingla home" className="ps-logo-link">
            <img src="/brand/mingla-wordmark.svg" alt="Mingla" width="116" height="41" />
          </Link>

          <button
            ref={menuButtonRef}
            type="button"
            className="ps-menu-button"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="page-system-audience-menu"
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" size={20} />
          </button>
        </div>
      </header>

      <SideMenu
        id="page-system-audience-menu"
        open={open}
        onClose={() => setOpen(false)}
        title="Menu"
        interactionSuspended={childDialogOpen}
      >
        <AudienceMenuContent
          surface={surface}
          onDismiss={() => setOpen(false)}
          onChildDialogOpenChange={setChildDialogOpen}
        />
      </SideMenu>
    </>
  )
}
