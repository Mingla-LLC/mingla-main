export interface PolicySection { readonly id: string; readonly title: string; readonly paragraphs: readonly string[]; readonly bullets?: readonly string[] }

export function EditorialPolicy({ sections }: { readonly sections: readonly PolicySection[] }) {
  return (
    <div className="core-policy-layout">
      <nav aria-label="Editorial standards sections"><strong>On this page</strong><ol>{sections.map((section, i) => <li key={section.id}><a href={`#${section.id}`}>{i + 1}. {section.title}</a></li>)}</ol></nav>
      <div className="core-policy-body">
        {sections.map((section, i) => (
          <section id={section.id} key={section.id}>
            <span>{String(i + 1).padStart(2, '0')}</span><h2>{section.title}</h2>
            {section.paragraphs.map((p) => <p key={p.slice(0, 48)}>{p}</p>)}
            {section.bullets ? <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          </section>
        ))}
      </div>
    </div>
  )
}
