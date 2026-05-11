# REVIEW ORCH-0770 - Public Event Video Browser Black Hero

> **Date:** 2026-05-09  
> **Reviewer:** Orchestrator  
> **Input:** `reports/INVESTIGATION_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md`  
> **Verdict:** ACCEPTED - root cause proven, SPEC required before implementation

## Plain-English Summary

The public event page is black in browser because the uploaded videos are not truly browser-safe videos.

The app is accepting iPhone-native video files that the iPhone app can play, but browsers often cannot. The proven failing files are public Supabase objects served as QuickTime/MOV (`video/quicktime`) with HEVC (`hvc1`) video inside. At least one failing object also has the video metadata (`moov`) after the media bytes (`mdat`), which makes browser startup worse. Browser players want a web-safe artifact: usually MP4 with H.264 (`avc1`) video, AAC audio, fast-start metadata, and `video/mp4`.

So the root issue is not "the video component needs another prop." It is: **Mingla is publishing raw picker video as public web video without a browser-safe processing/validation contract.**

## Accepted Evidence

- Failing public URL was probed directly from Supabase Storage.
- Response headers prove it is served as `content-type: video/quicktime`.
- Atom/byte inspection proves QuickTime/MOV structure and HEVC `hvc1` markers, with no H.264 `avc1` marker in the failing examples.
- One failing sample had `moov` after `mdat`, proving non-fast-start ordering.
- Existing tests still encode the wrong contract by expecting iOS MOV upload to remain `.mov` / `video/quicktime`.
- Public page chrome currently positions close/share controls separately from the media sound control, causing safe-area overlap on mobile.

## Decision

Do not dispatch another implementor pass yet.

This needs a focused `$forensics` SPEC because the next implementation must choose and precisely define the media-processing contract:

1. Preferred production path: process uploaded video into a browser-safe derivative before it becomes a public cover.
2. Minimum launch-safe fallback: reject browser-unsafe raw videos with clear copy and do not save them as public covers.
3. Public page UI repair: close/share/sound controls must live in one safe-area-aware chrome layout.

## Required Next Prompt

Dispatch:

`prompts/SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md`

Expected output:

`specs/SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md`

## Hard Guard

Do not proceed to Giphy/Pexels, brand media, profile media, ticket media, or another public-video player-only patch until ORCH-0770 has a browser-safe video contract and implementation plan.
