export interface DisclosureEntry { readonly question: string; readonly answer: string }

export function NativeDisclosureList({ entries }: { readonly entries: readonly DisclosureEntry[] }) {
  return (
    <div className="core-disclosures">
      {entries.map((entry) => (
        <details key={entry.question}>
          <summary>{entry.question}</summary>
          <p>{entry.answer}</p>
        </details>
      ))}
    </div>
  )
}
