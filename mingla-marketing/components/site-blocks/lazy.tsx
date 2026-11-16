'use client'

// #4452 — the site blocks and the editor markers load as their own chunks, so a
// page's first-load JavaScript stays inside the #4339 speed budget whether or
// not it shows a block (server-rendered HTML is unchanged; only the script
// arrives after first load).
import dynamic from 'next/dynamic'

export const LazyFormBlock = dynamic(() => import('./form-block').then((m) => m.FormBlock))
export const LazyAddHere = dynamic(() => import('./editor-bridge').then((m) => m.AddHere))
export const LazyBlockOutline = dynamic(() => import('./editor-bridge').then((m) => m.BlockOutline))
export const LazyHeroOutline = dynamic(() => import('./editor-bridge').then((m) => m.HeroOutline))
export const LazyButtonRow = dynamic(() => import('./button-row').then((m) => m.ButtonRow))
export const LazyBannerBlock = dynamic(() => import('./banner').then((m) => m.BannerBlock))
