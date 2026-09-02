import '@/components/cutout/cutout.css'

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* ORCH-1224 — explorer has NO footer: the consumer page is a deliberate
          one-viewport non-scrolling hero (hero.tsx h-[100svh]) with its own
          bottom pill row + popup modal sheets (Support/Privacy/Terms). The
          footer stays mounted on the business surface only (app/host/layout.tsx).
          This reverts ORCH-1223's explorer re-mount per Seth 2026-06-22. */}
      <main id="main">{children}</main>
    </>
  )
}
