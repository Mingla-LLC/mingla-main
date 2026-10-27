import { Fragment, type ReactNode } from 'react'
import { parseBlogRichText, type BlogRichNode } from '@mingla/blog-document'
import { DeviceCta } from '@/components/cutout/device-cta'

// #4137 — rich text WITHOUT dangerouslySetInnerHTML. The stored HTML is parsed
// by the shared tokenising sanitiser (packages/blog-document) into an
// allow-listed tree (strong, em, u, br, links) and rendered as React elements,
// so no stored markup ever reaches the DOM as HTML. An app link
// (`data-mingla-target="place:…"` / `"offering:…"`) becomes the device-aware
// Explorer CTA: the OneLink on phones, the QR pop-up on a computer.

function renderNodes(nodes: readonly BlogRichNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`
    switch (node.type) {
      case 'text': return <Fragment key={key}>{node.text}</Fragment>
      case 'br': return <br key={key} />
      case 'strong': return <strong key={key}>{renderNodes(node.children, `${key}.`)}</strong>
      case 'em': return <em key={key}>{renderNodes(node.children, `${key}.`)}</em>
      case 'u': return <u key={key}>{renderNodes(node.children, `${key}.`)}</u>
      case 'link':
        return node.newTab || node.href.startsWith('https://')
          ? <a key={key} href={node.href} target={node.newTab ? '_blank' : undefined} rel="noopener noreferrer">{renderNodes(node.children, `${key}.`)}</a>
          : <a key={key} href={node.href}>{renderNodes(node.children, `${key}.`)}</a>
      case 'app_link':
        return (
          <DeviceCta
            key={key}
            surface="explorer"
            location="blog_inline_link"
            variant="inline"
            label={renderNodes(node.children, `${key}.`)}
          />
        )
    }
  })
}

export function BlogRichText({ html }: { readonly html: string }) {
  return <>{renderNodes(parseBlogRichText(html), '')}</>
}
