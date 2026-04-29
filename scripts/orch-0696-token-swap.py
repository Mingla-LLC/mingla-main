#!/usr/bin/env python3
"""
ORCH-0696 — Bulk-swap hardcoded light-mode color values to dark-mode equivalents
across the 10 ExpandedCardModal sub-components per spec §6.4.1.

Idempotent. Re-runs are no-ops once swaps are applied. Run from project root:
    python scripts/orch-0696-token-swap.py
"""

import re
from pathlib import Path

ROOT = Path("app-mobile/src/components/expandedCard")

# Files in scope (10) — per spec §6.4.2
FILES = [
    "ActionButtons.tsx",
    "BusynessSection.tsx",
    "CardInfoSection.tsx",
    "CompanionStopsSection.tsx",
    "ExpandedCardHeader.tsx",
    "ImageGallery.tsx",
    "PracticalDetailsSection.tsx",
    "StopImageGallery.tsx",
    "TimelineSection.tsx",
    "WeatherSection.tsx",
]

# Canonical light → dark mapping per spec §6.4.1.
# Order matters — longer patterns first so we don't double-replace.
# Each tuple: (regex, replacement, description).
SWAPS = [
    # White / cream / paper backgrounds → glass-on-dark surface
    (r'"#ffffff"', '"rgba(255,255,255,0.10)"', "white bg → glass-dark"),
    (r"'#ffffff'", "'rgba(255,255,255,0.10)'", "white bg → glass-dark"),
    (r'"#fff"', '"rgba(255,255,255,0.10)"', "white bg → glass-dark"),
    (r"'#fff'", "'rgba(255,255,255,0.10)'", "white bg → glass-dark"),
    (r'"#FFFFFF"', '"rgba(255,255,255,0.10)"', "white bg → glass-dark"),
    (r"'#FFFFFF'", "'rgba(255,255,255,0.10)'", "white bg → glass-dark"),
    (r'"#FFF"', '"rgba(255,255,255,0.10)"', "white bg → glass-dark"),
    (r"'#FFF'", "'rgba(255,255,255,0.10)'", "white bg → glass-dark"),
    # Cream / orange-50 backgrounds → glass-dark
    (r'"#fff7ed"', '"rgba(255,255,255,0.10)"', "cream bg → glass-dark"),
    (r"'#fff7ed'", "'rgba(255,255,255,0.10)'", "cream bg → glass-dark"),
    (r'"#fef3e2"', '"rgba(255,255,255,0.10)"', "orange-50 bg → glass-dark"),
    (r"'#fef3e2'", "'rgba(255,255,255,0.10)'", "orange-50 bg → glass-dark"),
    (r'"#fef7f0"', '"rgba(255,255,255,0.10)"', "orange-50 bg → glass-dark"),
    (r"'#fef7f0'", "'rgba(255,255,255,0.10)'", "orange-50 bg → glass-dark"),
    # Gray-50 / gray-100 surfaces → glass-dark
    (r'"#f9fafb"', '"rgba(255,255,255,0.10)"', "gray-50 → glass-dark"),
    (r"'#f9fafb'", "'rgba(255,255,255,0.10)'", "gray-50 → glass-dark"),
    (r'"#f3f4f6"', '"rgba(255,255,255,0.10)"', "gray-100 → glass-dark"),
    (r"'#f3f4f6'", "'rgba(255,255,255,0.10)'", "gray-100 → glass-dark"),
    # Mini-bar track gray → glass-dark border
    (r'"#ebe6e7"', '"rgba(255,255,255,0.18)"', "track gray → glass-dark border"),
    (r"'#ebe6e7'", "'rgba(255,255,255,0.18)'", "track gray → glass-dark border"),
    # Gray borders → glass-dark border
    (r'"#e5e7eb"', '"rgba(255,255,255,0.18)"', "gray-200 border → glass-dark"),
    (r"'#e5e7eb'", "'rgba(255,255,255,0.18)'", "gray-200 border → glass-dark"),
    # Orange accent border → primary at 45% opacity
    (r'"#fed7aa"', '"rgba(235,120,37,0.45)"', "orange-200 border → primary 45%"),
    (r"'#fed7aa'", "'rgba(235,120,37,0.45)'", "orange-200 border → primary 45%"),
    # Primary text dark → white
    (r'"#111827"', '"#ffffff"', "gray-900 text → white"),
    (r"'#111827'", "'#ffffff'", "gray-900 text → white"),
    (r'"#1f2937"', '"#ffffff"', "gray-800 text → white"),
    (r"'#1f2937'", "'#ffffff'", "gray-800 text → white"),
    # Body text gray-700 → 80% white
    (r'"#374151"', '"rgba(255,255,255,0.80)"', "gray-700 → 80% white"),
    (r"'#374151'", "'rgba(255,255,255,0.80)'", "gray-700 → 80% white"),
    # Muted gray → 70% white
    (r'"#4b5563"', '"rgba(255,255,255,0.70)"', "gray-600 → 70% white"),
    (r"'#4b5563'", "'rgba(255,255,255,0.70)'", "gray-600 → 70% white"),
    (r'"#6b7280"', '"rgba(255,255,255,0.70)"', "gray-500 → 70% white"),
    (r"'#6b7280'", "'rgba(255,255,255,0.70)'", "gray-500 → 70% white"),
    # Amber/orange text variants → primary
    (r'"#78350f"', '"#eb7825"', "amber-900 → primary"),
    (r"'#78350f'", "'#eb7825'", "amber-900 → primary"),
    (r'"#92400e"', '"#eb7825"', "amber-800 → primary"),
    (r"'#92400e'", "'#eb7825'", "amber-800 → primary"),
    (r'"#9a3412"', '"#eb7825"', "orange-800 → primary"),
    (r"'#9a3412'", "'#eb7825'", "orange-800 → primary"),
    (r'"#c2410c"', '"#eb7825"', "orange-700 → primary"),
    (r"'#c2410c'", "'#eb7825'", "orange-700 → primary"),
    (r'"#d97706"', '"#eb7825"', "amber-600 → primary"),
    (r"'#d97706'", "'#eb7825'", "amber-600 → primary"),
    (r'"#ea580c"', '"#eb7825"', "orange-600 → primary"),
    (r"'#ea580c'", "'#eb7825'", "orange-600 → primary"),
    # Light gray (disabled / very-muted) → 50% white
    (r'"#9ca3af"', '"rgba(255,255,255,0.50)"', "gray-400 → 50% white"),
    (r"'#9ca3af'", "'rgba(255,255,255,0.50)'", "gray-400 → 50% white"),
    (r'"#9CA3AF"', '"rgba(255,255,255,0.50)"', "gray-400 → 50% white"),
    (r"'#9CA3AF'", "'rgba(255,255,255,0.50)'", "gray-400 → 50% white"),
    (r'"#d1d5db"', '"rgba(255,255,255,0.50)"', "gray-300 → 50% white"),
    (r"'#d1d5db'", "'rgba(255,255,255,0.50)'", "gray-300 → 50% white"),
    # Error red bg → translucent red
    (r'"#fef2f2"', '"rgba(239,68,68,0.10)"', "red-50 bg → translucent red"),
    (r"'#fef2f2'", "'rgba(239,68,68,0.10)'", "red-50 bg → translucent red"),
    # Error red text-700 → red-300 lighter for legibility on dark
    (r'"#991b1b"', '"#FCA5A5"', "red-700 → red-300 lighter"),
    (r"'#991b1b'", "'#FCA5A5'", "red-700 → red-300 lighter"),
    # Indigo unchanged (#6366F1) — no rule
    # Star yellow unchanged (#fbbf24) — no rule
    # Black unchanged (#000000) — no rule (lightbox bg)
    # Gray #666 unchanged — no rule (sticky-CTA disabled gray)
]


def main() -> None:
    total_swaps = 0
    for fname in FILES:
        path = ROOT / fname
        if not path.exists():
            print(f"SKIP: {path} not found")
            continue
        original = path.read_text(encoding="utf-8")
        modified = original
        file_swaps = 0
        for pattern, replacement, _desc in SWAPS:
            new_text, n = re.subn(pattern, replacement, modified)
            if n > 0:
                modified = new_text
                file_swaps += n
        if file_swaps > 0:
            path.write_text(modified, encoding="utf-8", newline="\n")
        total_swaps += file_swaps
        print(f"{fname}: {file_swaps} swaps")
    print(f"\nTotal: {total_swaps} swaps across {len(FILES)} files.")


if __name__ == "__main__":
    main()
