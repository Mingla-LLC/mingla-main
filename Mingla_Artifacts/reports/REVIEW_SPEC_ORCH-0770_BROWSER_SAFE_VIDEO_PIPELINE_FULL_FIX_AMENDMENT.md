# REVIEW SPEC ORCH-0770 - Browser-Safe Video Pipeline Full-Fix Amendment

> **Date:** 2026-05-09  
> **Reviewer:** Orchestrator  
> **Reviewed spec:** `specs/SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md`  
> **Decision:** SUPERSEDED / AMENDMENT REQUIRED

## Plain-English Decision

The returned spec correctly identified the browser-safety problem, but it does not satisfy the product promise the operator now confirmed.

The correct Mingla experience is not "reject phone videos unless the organiser exports them as browser-ready MP4." The correct experience is:

1. Organisers can select videos shot on their phone without being blocked solely because the original file is over the final cover budget.
2. If the video is too long, Mingla provides an in-app trim path.
3. Mingla converts/transcodes the trimmed/source video into a browser-safe public cover video.
4. If the processed cover would be too large, Mingla compresses the final public cover derivative to fit the product cap.
5. Public event pages play the cover reliably in browser and app.

Therefore the rejection-only path can remain only as a failure fallback when processing cannot complete. It is not the primary fix.

## What Remains Accepted

The root cause from `reports/INVESTIGATION_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md` remains accepted:

- Raw iPhone MOV/QuickTime/HEVC assets are browser-hostile.
- Public browser pages need a web-safe derivative.
- Public page chrome must own a safe-area-aware sound/share/close control layout.

## What Is Superseded

The previous spec's implementation direction is superseded where it says the first implementation should primarily reject browser-unsafe video.

The new implementation architecture must specify a real processing pipeline:

- raw phone video upload;
- in-app trim when source duration is too long;
- server/provider/worker-side transcode;
- browser-safe MP4/H.264/AAC fast-start output;
- compression to a final public derivative no larger than 25 MB;
- processing status/error UX;
- fallback rejection only when processing cannot produce a safe derivative.

## Required Next Lifecycle Step

Dispatch `$forensics` with:

`prompts/FORENSICS_SPEC_AMENDMENT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`

Expected output:

`specs/SPEC_AMENDMENT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md`

Do not dispatch `$implementor` until the amended spec decides the processing architecture, provider/worker boundary, storage model, deployment/env gates, migration needs, and test/runtime proof matrix.

## Hard Guard

No Giphy/Pexels, brand media, profile media, ticket media, or provider picker work until this base phone-video-to-public-cover pipeline is specified and implemented.
