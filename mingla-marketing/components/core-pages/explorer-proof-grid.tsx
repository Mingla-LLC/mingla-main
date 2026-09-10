const PROOFS = [
  { title: 'Compare without losing the plan', body: 'Discover places, events, trips and experiences, inspect the details that change the decision, and save the useful options together.' },
  { title: 'Plan with people', body: 'Share a clear plan with the people you choose and keep the decision in one place instead of rebuilding it from disconnected messages.' },
  { title: 'Take the next real action', body: 'Use the reservation, RSVP or ticket action only when that action is actually available and clearly identified.' },
] as const

export function ExplorerProofGrid() {
  return (
    <div className="core-proof-grid">
      {PROOFS.map((proof, index) => (
        <article key={proof.title}>
          <div className="core-proof-mark" aria-hidden="true"><img src="/brand/mingla-logo-white-on-orange.png" alt="" /></div>
          <span>0{index + 1}</span><h3>{proof.title}</h3><p>{proof.body}</p>
        </article>
      ))}
    </div>
  )
}
