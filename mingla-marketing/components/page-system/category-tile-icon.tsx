'use client'

import {
  ChefHat,
  Clapperboard,
  Coffee,
  Drama,
  Gamepad2,
  MessagesSquare,
  Palette,
  Trees,
  Utensils,
  Wine,
  type LucideIcon,
} from 'lucide-react'
import type { ExplorerCategorySlug } from '@/content/page-system/shared'
import { CATEGORY_TILE_ICON } from '@/lib/city-place-rank'

// #4339 speed fix — the category glyph inside a place's no-photo tile
// (current-place-photo.tsx), split out so it loads only when a tile shows.

const TILE_ICONS: Readonly<Record<string, LucideIcon>> = {
  ChefHat, Clapperboard, Coffee, Drama, Gamepad2, MessagesSquare, Palette, Trees, Utensils, Wine,
}

export default function CategoryTileIcon({ categorySlug }: { readonly categorySlug: ExplorerCategorySlug }) {
  const Icon = TILE_ICONS[CATEGORY_TILE_ICON[categorySlug]] ?? Trees
  return <Icon aria-hidden="true" size={40} strokeWidth={1.6} />
}
