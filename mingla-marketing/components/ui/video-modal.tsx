'use client'
import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

interface VideoModalProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Optional embed URL (YouTube, Vimeo, mp4, etc.). When absent, shows placeholder. */
  src?: string
  /** Override the placeholder content shown when src is empty. */
  placeholder?: ReactNode
}

export function VideoModal({ open, onClose, title, src, placeholder }: VideoModalProps) {
  // ESC closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="video-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={title ?? 'Video player'}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 backdrop-blur-md"
        >
          <motion.div
            key="video-frame"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 220, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative aspect-video w-full max-w-[960px] overflow-hidden rounded-2xl bg-[#0c0e12] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
          >
            {src ? (
              <iframe
                src={src}
                title={title ?? 'Video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-white/70">
                {placeholder ?? (
                  <>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                      Mingla demo
                    </span>
                    <span className="font-display text-2xl text-white/85 md:text-4xl">
                      A short film of Mingla in action.
                    </span>
                    <span className="text-sm text-white/55">
                      Coming soon — we&apos;ll drop the real cut here.
                    </span>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close video"
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white transition-colors hover:bg-white/20 focus-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
