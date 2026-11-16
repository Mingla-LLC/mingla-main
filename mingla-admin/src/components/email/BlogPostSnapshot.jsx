// #4452 §5.7 — a blog-post block as the composer and its preview show it (moved out of EmailComposer).


export function BlogPostSnapshot({ block, preview = false }) {
  const snapshot = block.snapshot || {};
  const href = snapshot.slug ? `https://usemingla.com/blog/${snapshot.slug}` : "#";
  const eyebrow = `${String(snapshot.categoryLabel || "Mingla").toUpperCase()} · ${Number(snapshot.readMinutes || 1)} MIN READ`;
  if (block.style === "link") {
    return (
      <p className={`text-sm leading-6 ${preview ? "my-4" : ""}`}>
        <a href={href} className="font-bold text-[#2d2926] no-underline">{snapshot.title || "Blog post"}</a>
        <span className="text-[#756e68]"> · </span>
        <a href={href} className="font-semibold text-[#c4471a]">{block.buttonText || "Add button text"}</a>
      </p>
    );
  }
  if (block.style === "row") {
    return (
      <div className="my-2 flex gap-3 rounded-xl border border-[#e6e0d9] bg-white p-3">
        {snapshot.coverUrl && <img src={snapshot.coverUrl} alt={snapshot.coverAlt || ""} className="h-[72px] w-24 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a8450e]">{eyebrow}</p>
          <p className="mt-1 text-base font-extrabold leading-tight text-[#2d2926]">{snapshot.title || "Blog post"}</p>
          <p className="mt-1.5 text-xs font-bold text-[#c4471a]">{block.buttonText || "Add button text"} →</p>
        </div>
      </div>
    );
  }
  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-[#e6e0d9] bg-white">
      {snapshot.coverUrl && <img src={snapshot.coverUrl} alt={snapshot.coverAlt || ""} className="aspect-[2/1] w-full object-cover" />}
      <div className="p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#a8450e]">{eyebrow}</p>
        <p className="mt-1.5 text-lg font-extrabold leading-tight text-[#2d2926]">{snapshot.title || "Blog post"}</p>
        {snapshot.summary && <p className="mt-2 text-sm leading-6 text-[#756e68]">{snapshot.summary}</p>}
        <span className="mt-3 inline-block rounded-full bg-[#c4471a] px-4 py-2 text-xs font-bold text-white">{block.buttonText || "Add button text"}</span>
      </div>
    </div>
  );
}
