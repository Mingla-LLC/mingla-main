import {
  BlockquoteFeature,
  BoldFeature,
  HeadingFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";

/*
 * #2829 W5 — the one rich-text editor Studio offers for site content: exactly
 * what the published rich-text tree can carry (paragraphs, headings 2–4,
 * bold, italic, lists, links), the same set the Writing block uses. Anything
 * else would be typed in Studio and silently lost on the site.
 * #2829 W9r — plus quotes: the tree always had `quote` and the site renders
 * it; the Business app's story editor writes quotes, so Studio must open them.
 */
export function siteRichTextEditor() {
  return lexicalEditor({
    features: () => [
      ParagraphFeature(),
      HeadingFeature({ enabledHeadingSizes: ["h2", "h3", "h4"] }),
      BoldFeature(),
      ItalicFeature(),
      OrderedListFeature(),
      UnorderedListFeature(),
      LinkFeature({ enabledCollections: [] }),
      BlockquoteFeature(),
    ],
  });
}
