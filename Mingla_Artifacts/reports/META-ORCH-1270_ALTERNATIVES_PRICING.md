# META-ORCH-1270 — Cover-Video Hosting Alternatives + 2026 Pricing

Research only. No code changed. Use case: short (<=30s), muted, looping cover videos that autoplay on
event/venue cards. Delivered clip capped ~25 MB. Pipeline needs: signed direct client->provider upload
(iOS/Android/RN + web), transcode/compress to small web MP4 (server-side, or skip if app compresses),
poster/thumbnail (first frame), CDN delivery + caching, ideally a "processing done" webhook.
Hard requirement: NO delete-account-on-overage model. Predictable bill OK; account deletion NOT.

All prices web-sourced 2026 (July). Where region-dependent or possibly stale, flagged inline.

## 1. Cloudflare Stream

- Model: priced per VIDEO MINUTE, not per GB (file size irrelevant).
- Storage: $5 per 1,000 minutes stored (prepaid, bought in 1,000-min blocks -> ~$5/mo floor).
- Delivery: $1 per 1,000 minutes delivered (post-paid, usage-based). Ingress + encoding are FREE.
- No free tier for Stream itself.
- Direct/signed upload: YES — Direct Creator Uploads + tus resumable, no API key on client.
  Reserved minutes are held on the upload link and released on completion/expiry.
- Auto-transcode: YES (free). Auto thumbnail/poster: YES. Webhook on ready: YES.
- Delivery format: HLS/DASH adaptive AND downloadable MP4 (MP4 is what you want for an instant muted loop).
- Overage behavior: if prepaid storage runs out, NEW uploads are blocked; existing videos keep
  serving and delivery keeps billing. NO account deletion. SAFE.

## 2a. Bunny Stream (managed video)

- Storage: from $0.01/GB-mo. Delivery: from $0.005/GB (volume network) up to standard CDN regional
  rates. Transcoding FREE. $1/mo account minimum. 14-day trial. No standing free tier.
- Direct/signed upload: YES — tus resumable + pre-signed uploads; server signs with SHA256, no API
  key exposed to client. Good on poor mobile networks.
- Auto-transcode: YES (free). Auto thumbnail: YES. Webhook when video ready: YES (library setting).
- Delivery: HLS + MP4, own global CDN.
- Overage behavior: pure prepaid pay-as-you-go; if balance/limits hit, delivery pauses — NO account
  deletion. SAFE + predictable.

## 2b. Bunny Storage + CDN (dumb object storage + pull zone)

- Storage: HDD Standard $0.01/GB-mo single region (+$0.005–$0.01/GB per extra region); SSD Edge tier
  $0.02/GB per region. CDN delivery: same Bunny CDN bandwidth rates (below). Free storage->CDN traffic
  inside Bunny. $1/mo minimum.
- Bunny CDN bandwidth (2026, standard network 119 PoPs):
  - Europe & North America: $0.01/GB
  - Asia & Oceania: $0.03/GB
  - South America: $0.045/GB
  - Middle East & Africa: $0.06/GB (relevant: Nigeria traffic lands here)
  - Volume network (10 PoPs): $0.005/GB first 500 TB (cheaper but fewer PoPs).
- Direct/signed upload: PARTIAL — upload via storage-zone access key; can pre-sign, but the token model
  is coarse (zone-level), weaker than Stream/Supabase per-file signed URLs for untrusted clients.
- Auto-transcode: NO. Auto thumbnail/poster: NO. Processing webhook: NO (it's dumb storage).
- Delivery: YES, global CDN, range requests, strong caching. Overage: prepaid, NO deletion. SAFE.
- REQUIRES client-side compression to the 25 MB MP4 + a client-generated poster frame.

## 3. Supabase Storage (they ALREADY pay Pro, $25/mo)

- Storage: 100 GB included on Pro, then $0.021/GB-mo overage.
- Egress: 250 GB included (SHARED across whole project — DB/API/storage, not video-only), then
  cached $0.03/GB, uncached $0.09/GB overage.
- Direct/signed upload: YES — createSignedUploadUrl + tus resumable.
- Auto-transcode: NO. Auto video thumbnail/poster: NO (image transforms exist, but not video-frame
  extraction). Processing webhook: PARTIAL (Storage object-insert event fires, but there's no
  "transcode done" because nothing transcodes).
- Delivery: YES via Smart CDN with HTTP range-request support (works for `<video>`). Caveat: video
  byte-range GETs cache less cleanly than whole files, so some egress may bill at the uncached $0.09
  rather than cached $0.03 — assume the worse rate for planning.
- Overage behavior: Spend Cap is ON by default -> exceeding quota RESTRICTS/pauses the item (videos
  stop serving) rather than billing; turn Spend Cap OFF to bill instead. Either way NO account
  deletion. SAFE on billing, but "restrict" is an availability risk if the shared 250 GB is exhausted.
- REQUIRES client-side compression to the 25 MB MP4 + a client-generated poster frame.

## 4. Reference points (not deep-dived)

- Mux: premium. Encoding $0.0075/min, delivery $0.025/min, storage $0.00036–0.00144/min, first
  100k delivered min/mo free. Best-in-class DX but 25x Cloudflare's per-minute delivery — overkill/pricey
  for muted 30s loops.
- AWS S3 + CloudFront: DIY. S3 ~$0.023/GB-mo storage; CloudFront ~$0.085/GB egress US/EU (first 10 TB,
  1 TB always-free), S3->CloudFront transfer free in same account. No transcode (need MediaConvert),
  no thumbnails, no webhook — you build the whole pipeline. Most engineering, not cheapest here.

## Capability matrix

Legend Y/N/P (partial). Rows: [CF Stream | Bunny Stream | Bunny Storage+CDN | Supabase Storage]

- Direct signed upload:            Y | Y | P | Y
- Auto-transcode (server-side):    Y | Y | N | N
- Auto thumbnail/poster:           Y | Y | N | N
- Webhook (processing done):       Y | Y | N | P
- CDN delivery + caching:          Y | Y | Y | Y
- Overage = bill, NOT deletion:    Y | Y | Y | Y
- Free / already-paid tier:        N | N | N | Y (100 GB + 250 GB egress in existing $25 Pro)

## Cost estimate — THIS use case

Assumptions: 500 videos stored, 25 MB each, ~30s each (= 0.5 video-min). Plays counted as a full 25 MB
download (worst case for muted autoloop). Volumes: 1,000 / 10,000 / 50,000 plays/mo = 25 GB / 250 GB /
1.25 TB egress. Bunny delivery figured at $0.01/GB (EU/NA standard); Nigeria/Africa traffic on standard
network is $0.06/GB — if a large share is African, multiply Bunny/Bunny-Storage delivery accordingly, or
use the $0.005/GB volume network. Supabase = MARGINAL cost on top of the $25/mo Pro they already pay.

Monthly $ (storage + delivery), [1k | 10k | 50k plays]:

- Cloudflare Stream: ~$5.50 | ~$10 | ~$30
  (storage floored at $5/mo for 250 stored min; delivery $0.50 / $5 / $25). Size-independent, very predictable.
- Bunny Stream: ~$1 | ~$2.6 | ~$12.6
  (storage 12.5 GB = $0.13; delivery $0.25 / $2.50 / $12.50 at $0.01/GB). Cheapest full pipeline.
- Bunny Storage + CDN: ~$1 | ~$2.6 | ~$12.6
  (essentially identical to Bunny Stream on cost, but NO transcode/thumbnail/webhook — needs client compression).
- Supabase Storage (marginal, +existing $25 Pro): ~$0 | ~$0 | +$30 cached / +$90 uncached
  (12.5 GB store is inside 100 GB; 25 GB & 250 GB egress fit the included 250 GB — but 250 GB eats the
  ENTIRE shared allowance; at 1.25 TB you're ~1,000 GB over -> +$30 to +$90). Needs client compression.

## Recommendation

For cheapest AND most sustainable short muted autoplay loops: **Bunny Stream** is the winner. It has the
full pipeline built in — pre-signed/tus direct upload from mobile+web, FREE transcoding to a small web MP4,
auto thumbnail/poster, a "video ready" webhook, and its own global CDN — at pay-as-you-go per-GB rates that
are trivial for 30s clips (~$1–$13/mo across 1k–50k plays), on a prepaid model that pauses (never deletes)
if you stop paying. Because transcoding is server-side, it needs NO client-side compression, which keeps the
mobile app simple and guarantees the 25 MB cap regardless of what users upload. Cloudflare Stream is the
equally-safe runner-up (same feature set, size-independent per-minute billing, ~$5.50–$30/mo) — pick it if
you'd rather bill per-minute and want Cloudflare's edge. If minimizing NEW spend matters more than
simplicity, Supabase Storage is ~$0 marginal at 1k–10k plays since they already pay Pro — BUT it REQUIRES
client-side compression (to hit 25 MB / web-friendly MP4) AND a client-generated poster frame, has no
transcode/webhook, and its 250 GB egress is shared with the whole app (availability risk at scale). Both
Supabase Storage and Bunny Storage+CDN only work with client-side compression added.

## Disqualifiers (rejected options)

- Cloudflare Stream: not disqualified — viable #2. Only downside: ~$5/mo storage floor + per-minute (vs per-GB) billing = slightly pricier than Bunny at every tier.
- Bunny Storage + CDN: no transcode, no auto thumbnail, no processing webhook — forces full client-side pipeline for the same cost as Bunny Stream.
- Supabase Storage: no server-side transcode + no video thumbnail; shared 250 GB egress is an availability risk and 50k plays cost +$30–$90.
- Mux: premium delivery ($0.025/min ~= 25x Cloudflare) — overkill/expensive for muted 30s loops.
- AWS S3 + CloudFront: no transcode/thumbnail/webhook out of the box; most DIY engineering, not cheapest.

Sources (2026, web): developers.cloudflare.com/stream/pricing, bunny.net/pricing/stream, bunny.net/pricing/storage,
bunny.net/pricing (CDN), docs.bunny.net/stream/tus-resumable-uploads, supabase.com/pricing,
supabase.com/docs/guides/storage/pricing, supabase.com/docs/guides/platform/cost-control, mux.com/pricing, aws.amazon.com/s3/pricing.
