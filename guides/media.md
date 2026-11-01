# Media processing

[Back to the project README](../README.md)

Upload formats, normalization, access control and file lifecycle.

## Shared media

The API stores only normalized JPEGs. JPEG, PNG, WebP and still HEIC/HEIF inputs
are limited to 20 MiB, 60 million pixels and 12,000 pixels per side. Animated
images, SVG and unsupported formats are refused based on their contents, not
their filename or declared MIME type. Photos fit within 1,920 pixels with a
480-pixel thumbnail; avatars are 512 × 512. Initial JPEG qualities are 82 for
photos and 80 for thumbnails/avatars. Orientation is applied, colors become
sRGB, transparency becomes white, and EXIF/GPS/XMP metadata is removed.

`MEDIA_ROOT` optionally selects an absolute local directory; its default is
`.media/` at the repository root. Production Compose mounts `media_data` at
`/media`, outside Caddy's static files. PostgreSQL stores media IDs, dimensions,
ownership and lifecycle state in `media_assets`; clients never receive disk paths.
The runtime includes `heif-info` and `heif-dec` from Debian trixie's maintained
`libheif-examples` package, including its security updates. Exact Debian security
revisions are not pinned against live mirrors: superseded versions can disappear.
The build logs record the installed `libheif-examples`/`libheif1` versions, and
`apt-get update` fails if any configured repository cannot be refreshed.
Rebuilding a commit can therefore select newer Debian security packages;
deployments still use the already-published image tagged with the commit SHA.
Native local HEIC processing requires those tools on `PATH`; the reproducible
HEIC check is `pnpm test:production`, which uses the shipped Docker runtime.

| Operation | Contract |
| --- | --- |
| `PUT /api/profiles/me/avatar` | Guest cookie, open hub, exact `Origin` and `X-Guest-Request: 1`; multipart file named `file`, optionally one JSON `crop` field; returns the current profile with `avatarMediaId` |
| `DELETE /api/profiles/me/avatar` | Same access requirements; removes the avatar reference and returns `avatarMediaId: null`, which selects the frontend default |
| `GET /api/media/:id/image` | Current avatar owner or organizer; Coffre photos are organizer-only here |
| `GET /api/media/:id/thumbnail` | Same photo access rules; avatars have no thumbnail variant |

Crop coordinates are fractions of the oriented image: `left` and `top` are in
`[0, 1]`; `size` is in `(0, 1]` and scales the shorter side. The entire square
must fit inside the image. Without a crop, the avatar uses a centered square.
The multipart limits allow one file, one field and two parts. Caddy additionally
rejects requests above 21 MiB. Upload/processing is serialized per API instance;
a competing upload receives `429 MEDIA_BUSY` with `Retry-After: 2`. The worker
has a 30-second deadline. Compose caps the API and decoder processes together at
512 MiB and one CPU; the JavaScript heap limit alone does not bound native memory.
Validation errors use stable codes, including `MEDIA_TOO_LARGE`,
`IMAGE_DIMENSIONS_EXCEEDED`, `INVALID_CROP` and `UNSUPPORTED_IMAGE`.

Media reads use `Cache-Control: private, no-store`. Unknown and inaccessible
media return the same 404. Closing the hub blocks guest media reads without
revoking sessions. Organizer reads remain independently authenticated. A media
ID or knowledge of a former file URL never replaces authorization.

### Coffre integration contract

The Coffre module owns the contribution record, deadline and validated `frameId`.
It composes a single media service for avatars and contributions:

1. Authenticate before reading uploads, then use `preparePhoto(ownerProfileId,
   receive)` with the bounded multipart receiver. This returns a tracked,
   unreadable `staged` photo.
2. In the contribution transaction, recheck the deadline/rights and call
   `attachPhoto(tx, mediaId, ownerProfileId)` together with the contribution insert.
   A failed transaction leaves the photo staged; call `discardPhoto` on rejection.
3. Supply `contributionContext(mediaId)` to the shared media service, reading the saved
   contribution and server revelation state. Missing/deleted context denies reads.
   Private media are organizer-only. Public photos and thumbnails are available
   to paired TV screens only through the TV routes after revelation of the
   current Coffre. Ordinary media routes keep Coffre photos organizer-only.
   Authors receive no separate read permission.
4. On organizer deletion, call `markPhotoDeleting(tx, mediaId)` in the same
   transaction as clearing the contribution's content/media reference; cleanup
   can retry physical removal.

Frames remain separate UI overlays and are never baked into these JPEGs. There
is no standalone guest photo-upload route; the Coffre module owns launch and deposits.
The service cleans temporary originals after success/failure and retries media
marked `deleting`, plus abandoned `pending`/`staged` uploads older than 15 minutes,
at startup and every minute. Ready souvenirs are not age-purged; ENG-59 owns
retention. Run only one API instance against a media root: the upload guard is
process-local, and shared-volume multi-instance operation is not supported.

`pnpm test` covers conversion and policy boundaries. `pnpm test:db:isolated`
covers real HTTP handlers, ownership, lifecycle transactions and crash leftovers.
`pnpm test:production` checks real iPhone HEIC fixtures through Caddy/libheif,
proxy limits, volume persistence on API recreation and matching dump/archive
restoration. Fixture attribution and checksums are in
`apps/api/test/fixtures/media/README.md`.
