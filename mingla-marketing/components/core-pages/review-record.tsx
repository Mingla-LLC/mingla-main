export function ReviewRecord({ reviewedAt, label = 'Page record' }: { readonly reviewedAt: string; readonly label?: string }) {
  return (
    <aside className="core-review-record" aria-label={label}>
      <strong>{label}</strong>
      <span>Publisher: MINGLA LLC</span>
      <span>Reviewed: <time dateTime={reviewedAt}>10 September 2026</time></span>
      <a href="mailto:support@usemingla.com?subject=Mingla%20page%20correction">Report a correction</a>
    </aside>
  )
}
