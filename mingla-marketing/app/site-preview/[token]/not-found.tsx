// #4452 §2.9 — an expired or unknown preview token: the message, status 404, no draft content.
export default function PreviewExpired() {
  return (
    <main className="sp-expired">
      <h1>This preview has expired.</h1>
      <p>Open it again from Admin.</p>
    </main>
  )
}
