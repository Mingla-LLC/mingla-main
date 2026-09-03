#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const audienceMenu = read('components/cutout/audience-menu-content.tsx')
const cutoutNav = read('components/cutout/cutout-nav.tsx')
const pageSystemNav = read('components/page-system/page-system-nav.tsx')
const pageSystemShell = read('components/page-system/page-system-shell.tsx')
const sideMenu = read('components/ui/side-menu.tsx')
const deviceCta = read('components/cutout/device-cta.tsx')
const pageSystemCss = read('components/page-system/page-system.css')
const packageJson = JSON.parse(read('package.json'))

const exploreCtaIndex = audienceMenu.indexOf('label="Explore Your City"')
const hostCtaIndex = audienceMenu.indexOf('label="Host Your City"')
assert(exploreCtaIndex >= 0, 'shared menu must render the exact Explorer CTA label')
assert(hostCtaIndex > exploreCtaIndex, 'Host Your City must follow Explore Your City')
assert.match(audienceMenu, /href: '\/', label: 'Explorer', surface: 'explorer'/)
assert.match(audienceMenu, /href: '\/host', label: 'Host', surface: 'host'/)
assert.match(audienceMenu, /pathname === '\/'/)
assert.doesNotMatch(audienceMenu, /pathname\.startsWith\('\/'\)/)
assert.match(audienceMenu, /location="side_menu_explorer"/)
assert.match(audienceMenu, /location="side_menu_host"/)
assert.match(audienceMenu, /surface="explorer"[\s\S]*variant="primary"/)
assert.match(audienceMenu, /surface="host"[\s\S]*variant="ink"/)
assert.match(audienceMenu, /onExternalActivate=\{onDismiss\}/)
assert.match(audienceMenu, /onDialogOpenChange=\{onChildDialogOpenChange\}/)
assert.match(audienceMenu, /className="mt-auto flex flex-col gap-2\.5 pt-6"/)
process.stdout.write('PASS one shared audience owner, exact active map and ordered device-aware CTAs\n')

for (const [name, source] of [['CutoutNav', cutoutNav], ['PageSystemNav', pageSystemNav]]) {
  assert.match(source, /import \{ AudienceMenuContent \}/, `${name} must consume the shared menu owner`)
  assert.match(source, /<SideMenu/, `${name} must use the established SideMenu`)
  assert.match(source, /<AudienceMenuContent/, `${name} must render the shared content`)
  assert.match(source, /aria-haspopup="dialog"/, `${name} trigger must expose dialog semantics`)
  assert.match(source, /aria-controls=/, `${name} trigger must own its panel ID`)
  assert.match(source, /interactionSuspended=\{childDialogOpen\}/, `${name} must suspend for the nested QR`)
}
assert.doesNotMatch(pageSystemNav, /ps-desktop-nav|ps-nav-link|Choose a side|private fixtures|DESTINATIONS/)
assert.match(pageSystemShell, /<PageSystemNav surface=\{audience === 'host' \? 'host' : 'explorer'\} \/>/)
process.stdout.write('PASS both navigation shells use SideMenu at every width with no parallel Page System menu\n')

assert.match(sideMenu, /role="dialog"/)
assert.match(sideMenu, /aria-modal="true"/)
assert.match(sideMenu, /aria-labelledby=\{titleId\}/)
assert.match(sideMenu, /interactionSuspended\?: boolean/)
assert.match(sideMenu, /if \(!open \|\| interactionSuspended\) return/)
assert.match(sideMenu, /restoreFocusRef\.current = document\.activeElement/)
assert.match(sideMenu, /window\.setTimeout\(\(\) => trigger\?\.focus\(\), 0\)/)
assert.match(sideMenu, /document\.body\.style\.overflow = 'hidden'/)
assert.match(sideMenu, /document\.body\.style\.overflow = previous/)
assert.match(sideMenu, /overflow-y-auto/)
assert.match(sideMenu, /max-w-sm/)
assert.match(sideMenu, /paddingTop: 'max\(0\.75rem, env\(safe-area-inset-top\)\)'/)
assert.match(sideMenu, /transition=\{\{ duration: reduced \? 0/)
assert.match(deviceCta, /onExternalActivate\?: \(\) => void/)
assert.equal((deviceCta.match(/onExternalActivate\?\.\(\)/g) ?? []).length, 2,
  'only real external navigations may dismiss the containing menu')
assert.match(deviceCta, /setQrOpen\(true\)[\s\S]*onDialogOpenChange\?\.\(true\)/)
assert.match(deviceCta, /setQrOpen\(false\)[\s\S]*onDialogOpenChange\?\.\(false\)/)
process.stdout.write('PASS focus return, Escape/focus suspension and nested QR body-lock handoff\n')

assert.doesNotMatch(pageSystemCss, /\.ps-desktop-nav|\.ps-nav-link|\.ps-menu-layer|\.ps-menu-panel|\.ps-menu-note/)
assert.match(pageSystemCss, /\.ps-menu-button\s*\{[^}]*display: inline-flex/)
assert.match(pageSystemCss, /--page-host-bar-height: calc\(48px \+ env\(safe-area-inset-top\)\)/)
assert.match(pageSystemCss, /--page-host-bar-height: calc\(52px \+ env\(safe-area-inset-top\)\)/)
assert.match(pageSystemCss, /\.page-system-root\[data-host-acquisition='true'\] \.ps-catalogue-controls \{ top: var\(--page-host-bar-height\); \}/)
assert.doesNotMatch(pageSystemCss.match(/\.ps-nav\s*\{([^}]*)\}/)?.[1] ?? '', /position:\s*fixed/)
process.stdout.write('PASS Page System keeps Host offsets and sticky catalogue while removing dead menu CSS\n')

for (const route of [
  'app/internal/page-system/city-lagos/page.tsx',
  'app/internal/page-system/explorer-event-guide/page.tsx',
  'app/internal/page-system/host-event-promoter-guide/page.tsx',
]) {
  assert.match(read(route), /publicNoindexMetadata\(/, `${route} must remain private noindex`)
}
const guardCommand = 'node scripts/issue-2990-audience-navigation.implementor.happy.test.mjs'
assert(packageJson.scripts.build.includes(`${guardCommand} && next build`),
  'production build must enforce the new navigation contract')
process.stdout.write('PASS private routes and build-time regression enforcement remain intact\n')

process.stdout.write('PASS issue #2990 audience navigation implementor happy-path guard\n')
