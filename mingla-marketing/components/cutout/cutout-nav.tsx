'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { SideMenu } from '@/components/ui/side-menu'
import { DeviceCta, type CutoutSurface } from './device-cta'
import { AudienceMenuContent } from './audience-menu-content'

// ---------------------------------------------------------------
// #2902 — Cutout nav. No bar, no dock.
//
// The floating dock is gone: the side panel is now the only menu, at every
// width, so there is one navigation model rather than two doing the same job.
// What floats over the hero is three separate moulded surfaces — wordmark,
// action, menu button — with nothing tying them together.
//
// BREATHING ROOM AND CONCENTRIC CURVES. The shell's corner radius is 40px and
// it sits 12px inside the viewport. Elements pinned at 14px were only ~2px off
// the shell's edge, fouling that corner. They now sit 28px from the viewport,
// i.e. 16px inside the shell — which is 40px minus a pill's own ~24px radius,
// so the pill's curve runs concentric with the shell's instead of cutting
// across it. The horizontal inset matches for the same reason.
// ---------------------------------------------------------------

interface CutoutNavProps {
  surface: CutoutSurface
  homeHref: string
  /** Explorer moves its action beneath the headline, so the nav drops it. */
  showAction?: boolean
}

export function CutoutNav({ surface, showAction = true }: CutoutNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [childDialogOpen, setChildDialogOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-50 px-5 sm:px-7"
        style={{ top: 'max(1.75rem, calc(env(safe-area-inset-top) + 0.75rem))' }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link
            /* The wordmark goes HOME, not to the current surface. It was bound
               to homeHref, so on /host it linked to /host. */
            href="/"
            aria-label="Mingla home"
            className="cut-card pointer-events-auto inline-flex shrink-0 items-center rounded-full px-5 py-3 focus-ring"
          >
            <img
              src="/brand/mingla-wordmark.svg"
              alt="Mingla"
              width={110}
              height={28}
              className="h-6 w-auto select-none sm:h-7"
              draggable={false}
            />
          </Link>

          <div className="pointer-events-auto ml-auto flex items-center gap-2.5">
            {/* Hidden below `sm`, because even at one icon the pill plus the
                wordmark plus the menu button overflow a 390px bar. The side
                panel carries the action there.

                The WRAPPER carries `hidden`, not the button. Passing `hidden`
                to DeviceCta did nothing: `.cut-btn` sets `display:inline-flex`
                and cutout.css loads after Tailwind's utilities, so the custom
                class won and the CTA rendered anyway — overflowing the header
                on every phone. A build cannot catch that; only looking at 390px
                did. */}
            {showAction ? (
              <div className="hidden sm:block">
                <DeviceCta surface={surface} location="nav" variant="quiet" size="md" />
              </div>
            ) : null}

            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="cutout-audience-menu"
              className="cut-btn cut-btn-light flex h-12 w-12 items-center justify-center rounded-full focus-ring"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <SideMenu
        id="cutout-audience-menu"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Menu"
        interactionSuspended={childDialogOpen}
      >
        <AudienceMenuContent
          surface={surface}
          onDismiss={() => setMenuOpen(false)}
          onChildDialogOpenChange={setChildDialogOpen}
        />
      </SideMenu>
    </>
  )
}
