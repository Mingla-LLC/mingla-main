// META-ORCH-1222 [Careers site] — minimal, safe server-side markdown → HTML for
// the JD `body`. Supports exactly the subset the seed bodies use + DESIGN §3.2.4
// styles: ## h2, ### h3, - lists, **bold**, [text](url) links, paragraphs.
//
// SECURITY: the input is HTML-ESCAPED FIRST, then a closed allow-list of inline
// markdown is re-introduced. No raw HTML passthrough — even though JD bodies are
// admin-authored (admin RPC), escaping first makes XSS impossible if a body ever
// carries a tag. Links are forced to http(s) and rel="noopener". The output is
// rendered via dangerouslySetInnerHTML on the server, so it MUST be trusted —
// this renderer is the trust boundary.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Inline: **bold** and [text](http(s)://url). Applied to already-escaped text.
function renderInline(escaped: string): string {
  let out = escaped
  // Links — only http/https. The url + label are already escaped.
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="careers-md-a">${label}</a>`,
  )
  // Bold.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out
}

export function renderJobBody(markdown: string): string {
  const lines = (markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let listOpen = false
  let paraBuf: string[] = []

  const flushPara = () => {
    if (paraBuf.length > 0) {
      const text = renderInline(escapeHtml(paraBuf.join(' ')))
      html.push(`<p class="careers-md-p">${text}</p>`)
      paraBuf = []
    }
  }
  const closeList = () => {
    if (listOpen) {
      html.push('</ul>')
      listOpen = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushPara()
      closeList()
      continue
    }
    if (line.startsWith('### ')) {
      flushPara()
      closeList()
      html.push(`<h3 class="careers-md-h3">${renderInline(escapeHtml(line.slice(4)))}</h3>`)
      continue
    }
    if (line.startsWith('## ')) {
      flushPara()
      closeList()
      html.push(`<h2 class="careers-md-h2">${renderInline(escapeHtml(line.slice(3)))}</h2>`)
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara()
      if (!listOpen) {
        html.push('<ul class="careers-md-ul">')
        listOpen = true
      }
      const item = line.replace(/^[-*]\s+/, '')
      html.push(`<li class="careers-md-li">${renderInline(escapeHtml(item))}</li>`)
      continue
    }
    // Plain text → accumulate into a paragraph.
    paraBuf.push(line.trim())
  }
  flushPara()
  closeList()
  return html.join('\n')
}
