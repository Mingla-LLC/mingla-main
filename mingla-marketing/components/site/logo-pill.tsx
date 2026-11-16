// #4452 §2.13 — the logo pill: the white wordmark on an orange pill, in every
// top bar and header (the footer keeps its white-on-dark wordmark).
export function LogoPill({ phone = false }: { phone?: boolean }) {
  return (
    <span className="logo-pill" data-phone={phone ? '1' : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/links/mingla-wordmark-white.svg" alt="" width={72} height={20} />
    </span>
  )
}
