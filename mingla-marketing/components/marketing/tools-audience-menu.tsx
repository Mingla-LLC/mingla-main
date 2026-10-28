'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { AudienceMenuContent } from '@/components/cutout/audience-menu-content'
import { SideMenu } from '@/components/ui/side-menu'

// #4137: /tools keeps its dark Host header, but uses the same grouped menu
// content and focus-trapped panel as every other marketing surface.
export function ToolsAudienceMenu() {
  const [open, setOpen] = useState(false)
  const [childDialogOpen, setChildDialogOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="tools-audience-menu"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/8 text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
      >
        <Menu aria-hidden="true" size={20} />
      </button>
      <SideMenu
        id="tools-audience-menu"
        open={open}
        onClose={() => setOpen(false)}
        title="Menu"
        interactionSuspended={childDialogOpen}
      >
        <AudienceMenuContent
          surface="host"
          onDismiss={() => setOpen(false)}
          onChildDialogOpenChange={setChildDialogOpen}
        />
      </SideMenu>
    </>
  )
}
