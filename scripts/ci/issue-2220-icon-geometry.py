#!/usr/bin/env python3
"""#2220 / #2223 — icon geometry gate.

Two measurements CI never made, each corresponding to a defect that reached
production:

LAUNCHER SAFE ZONE (#2220). Android composites an adaptive icon at 108dp but
only guarantees the centre 66dp — 61.1% — is visible; circular and squircle
launchers clip the rest. Host's wordmark spanned 79.7% and both ends were cut.
This exact defect was fixed once (5102565cf, 2026-05-30, "add safe-zone margin
so adaptive mask doesn't crop") and reintroduced by the Business -> Host rebrand
(a5e567565, #2065), shipping publicly in 1.1.5. Nothing noticed, because nothing
measured the pixels.

TAB LEGIBILITY (#2223). Host's favicon was the wide wordmark squeezed into a
48px square — ink 37x13, aspect 2.85 — an unreadable smear at the 16px a tab
renders. Admin had already hit this and switched to a square mark (ISSUE-1001).

Pillow does the decoding on purpose. A hand-rolled PNG reader was tried first
and died three times on real repo assets — greyscale+alpha, Adam7 interlacing,
then palette colour — each time failing the build with a format error instead of
a measurement. A gate that cannot read the files it guards is worse than no gate.

  --self-test  proves both measurements catch deliberately broken icons.
"""
import sys
from PIL import Image

SAFE_FRACTION = 66 / 108      # Android's guaranteed-visible centre
TOLERANCE = 0.02              # 61.1% -> fails above ~63.1%
FAVICON_MAX_ASPECT = 1.6      # a wordmark is ~2.9:1

ADAPTIVE = [
    ("mingla-business/assets/images/android-icon-foreground.png", (235, 120, 37)),
    ("mingla-business/assets/images/android-icon-monochrome.png", None),
    ("app-mobile/assets/adaptive-icon.png", None),
]
FAVICONS = [
    "app-mobile/assets/favicon.png",
    "mingla-business/assets/images/favicon.png",
]


def ink_box(path, background=None):
    """Bounding box of visible content.

    Transparent art is measured by alpha. Opaque art — the Host foreground bakes
    the brand orange in — is measured against its background colour, because an
    alpha test would call the entire canvas content and pass a broken icon.
    """
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    alpha = im.split()[-1]
    if background is None:
        box = alpha.getbbox()
        # A FULLY OPAQUE image tells an alpha test nothing — it reports the whole
        # canvas as content and would wave through the very wordmark favicon this
        # gate exists to reject. Fall back to the corner colour as the ground.
        if box == (0, 0, w, h) and alpha.getextrema() == (255, 255):
            background = im.convert("RGB").getpixel((0, 0))
        else:
            return w, h, box
    rgb = im.convert("RGB").load()
    a = alpha.load()
    left, top, right, bottom = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if a[x, y] <= 16:
                continue
            c = rgb[x, y]
            if max(abs(c[0] - background[0]), abs(c[1] - background[1]),
                   abs(c[2] - background[2])) <= 28:
                continue
            if x < left: left = x
            if x > right: right = x
            if y < top: top = y
            if y > bottom: bottom = y
    box = None if right < left else (left, top, right + 1, bottom + 1)
    return w, h, box


def check_adaptive(assets):
    failures = []
    limit = SAFE_FRACTION + TOLERANCE
    for path, background in assets:
        w, _h, box = ink_box(path, background)
        span = 0.0 if box is None else (box[2] - box[0]) / w
        ok = span <= limit
        print(f"  {'ok ' if ok else 'FAIL'} {span * 100:5.1f}%  (max {limit * 100:.1f}%)  {path}")
        if not ok:
            failures.append(
                f"{path}: content spans {span * 100:.1f}% of the canvas; Android only "
                f"guarantees the centre {SAFE_FRACTION * 100:.1f}%, so launchers crop it")
    return failures


def check_favicons(paths):
    failures = []
    for path in paths:
        _w, _h, box = ink_box(path)
        if box is None:
            failures.append(f"{path}: no visible ink")
            print(f"  FAIL empty        {path}")
            continue
        iw, ih = box[2] - box[0], box[3] - box[1]
        aspect = max(iw / ih, ih / iw)
        ok = aspect <= FAVICON_MAX_ASPECT
        print(f"  {'ok ' if ok else 'FAIL'} aspect {aspect:4.2f}  (max {FAVICON_MAX_ASPECT})  {path}")
        if not ok:
            failures.append(
                f"{path}: ink is {aspect:.2f}:1, too wide to read at 16px; "
                f"use the square chat mark, not the wordmark")
    return failures


def _fixture(size, draw):
    import tempfile, os
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw(im)
    fd, tmp = tempfile.mkstemp(suffix=".png"); os.close(fd)
    im.save(tmp)
    return tmp


def self_test():
    import os
    # Mirrors the real defect: an opaque brand-colour canvas with the mark
    # running nearly edge to edge. A plain filled square would not do — the
    # opaque fallback correctly reads a uniform canvas as pure background.
    def _edge(im):
        im.paste((235, 120, 37, 255), (0, 0, 64, 64))
        im.paste((255, 255, 255, 255), (2, 24, 62, 40))
    edge = _fixture(64, _edge)
    wide = _fixture(64, lambda im: im.paste((255, 255, 255, 255), (0, 24, 64, 40)))
    try:
        if not check_adaptive([(edge, None)]):
            print("#2220 self-test FAILED: an edge-to-edge launcher icon was not caught")
            return 1
        if not check_favicons([wide]):
            print("#2223 self-test FAILED: a wordmark-shaped favicon was not caught")
            return 1
        if check_adaptive(ADAPTIVE) or check_favicons(FAVICONS):
            print("#2220/#2223 self-test FAILED: the shipped assets do not pass a clean run")
            return 1
    finally:
        os.unlink(edge); os.unlink(wide)
    print("#2220/#2223 self-test passed "
          "(oversized launcher icon and wordmark favicon both caught; real assets clean).")
    return 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    failures = check_adaptive(ADAPTIVE) + check_favicons(FAVICONS)
    if failures:
        print("\n#2220/#2223 icon geometry gate FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("#2220/#2223 icon geometry gate: launcher icons inside the safe zone, "
          "tab icons legibly square.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
