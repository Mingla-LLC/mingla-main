import { readFileSync } from 'node:fs'

const supportPage = readFileSync(new URL('../app/support/page.tsx', import.meta.url), 'utf8')
const hero = readFileSync(
  new URL('../components/sections/explorer-home/hero.tsx', import.meta.url),
  'utf8',
)

const requiredSupportSnippets = [
  "title: 'Support'",
  'How can we help?',
  'within 1–2 business days',
  'mailto:support@usemingla.com',
  'href="/privacy-policy"',
  'href="/terms-of-service"',
  'href="/delete-account"',
  'Settings →',
  'Delete Account',
]

const requiredHeroSnippets = [
  'function SupportModal',
  'aria-labelledby="support-modal-title"',
  'const [supportOpen, setSupportOpen] = useState(false)',
  "onClick={() => setSupportOpen(true)}",
  '<SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />',
]

for (const snippet of requiredSupportSnippets) {
  if (!supportPage.includes(snippet)) {
    throw new Error(`Support page missing expected snippet: ${snippet}`)
  }
}

if (supportPage.includes('Support — Mingla')) {
  throw new Error('Support page metadata must not include the Mingla suffix directly')
}

const aboutIndex = hero.indexOf("{ href: '/about', label: 'About' }")
const supportIndex = hero.indexOf("{ href: '/support', label: 'Support' }")
const privacyIndex = hero.indexOf("{ href: '/privacy', label: 'Privacy' }")

if (aboutIndex === -1 || supportIndex === -1 || privacyIndex === -1) {
  throw new Error('Hero SITE_CHIPS is missing About, Support, or Privacy')
}

if (!(aboutIndex < supportIndex && supportIndex < privacyIndex)) {
  throw new Error('Support chip must appear between About and Privacy')
}

for (const snippet of requiredHeroSnippets) {
  if (!hero.includes(snippet)) {
    throw new Error(`Hero missing expected support modal snippet: ${snippet}`)
  }
}

console.log('Support page regression checks passed')
