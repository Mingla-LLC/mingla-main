import Image from 'next/image'

const PROOFS = [
  { frame: 'details', src: '/product-proof/explorer-saved-details.png', alt: 'Mingla Explorer showing the saved Sample sunset gallery plan open in its details sheet.', title: 'Compare without losing the plan', body: 'Discover places, events, trips and experiences, inspect the details that change the decision, and save the useful options together.' },
  { frame: 'full', src: '/product-proof/explorer-collaboration.png', alt: 'Mingla Explorer collaboration showing Sample Ava and Sample Noah agreeing on a saved gallery plan.', title: 'Plan with people', body: 'Share a clear plan with the people you choose and keep the decision in one place instead of rebuilding it from disconnected messages.' },
  { frame: 'full', src: '/product-proof/explorer-rsvp-pass.png', alt: 'Mingla Explorer RSVP pass for the Sample rooftop listening session, marked Going with a show-at-door code.', title: 'Take the next real action', body: 'Use the reservation, RSVP or ticket action only when that action is actually available and clearly identified.' },
] as const

export function ExplorerProofGrid() {
  return (
    <div className="core-proof-grid">
      {PROOFS.map((proof, index) => (
        <article key={proof.title}>
          <figure className={`core-proof-capture core-proof-capture--${proof.frame}`}>
            <Image src={proof.src} alt={proof.alt} width={1206} height={2622} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 70vw, 92vw" />
          </figure>
          <span>0{index + 1}</span><h3>{proof.title}</h3><p>{proof.body}</p>
        </article>
      ))}
    </div>
  )
}
