# Coffre

[Back to the project README](../README.md)

Guest deposits, organizer controls, successive Coffres and HTTP contracts.

## Coffre guest interface

`/coffre` requires a recognized guest and open hub. Unknown visitors go to the
personal-code login; closing the hub returns recognized guests to Invitations.
Before launch, Coffre displays a waiting screen without loading contributions.
The approved layout foregrounds the framed 3D scene, compact frame choices and
a short composer for text, one photo, or both.
A live preview shows the selected frame with the draft text/photo without uploading.
Guests then review the draft and select public/private visibility in a modal before sending.
The countdown explicitly separates open deposits from future revelation, uses
server time and closes new deposits at the deadline. After a receipt, a success
toast confirms the save and a fresh, empty draft is ready immediately. Its new
identity also replaces the model viewer so saved content is cleared from the scene.

The existing photo camera modal is reused on supported origins; HTTP LAN/mobile
uses the native capture picker. File imports remain available. Browser previews
that cannot decode HEIC display an explanation and keep the original file for
server validation. Both composer and confirmation previews use a lazy-loaded
Three.js viewer with drag/pinch, mouse-wheel zoom and keyboard navigation, without an action toolbar.
The viewer owns camera/light/resource lifecycle; each model owns its geometry
and printed content. `plain` is a flat card for text/photos; `one-wish-willow`
reuses the retained ENG-46 triangular-prism model for text only. The complete
500-character API limit is preserved, with fitted print and readable text in
confirmation. An explicitly labeled illustrated fallback handles unavailable or
lost WebGL. The TV uses its own renderer;
attribution/font licensing ship with the theme.

Draft content and files stay in component memory, not localStorage. Retrying an
unconfirmed submission keeps the exact UUID and payload; editing is locked until
its outcome is confirmed or explicitly rejected. There are no automatic write
retries. A successful receipt clears the draft and preview; the guest can start
another deposit but receives no individual content/read/edit/delete link.

After the countdown, `/coffre` displays a closed-deposit message directing guests
to the event television. It never loads a stored contribution list or saved
photos, including after reload. Uncertain own deposits can still retry their
original receipt without receiving stored content. Public revelation is reserved
to the [paired TV view](tv-and-spotify.md); organizer consultation remains available.

## Coffre API

The backend supports successive Coffres for the event. Its guest deposit
and organizer management interfaces are available, with a separate Three.js TV projection.
The [Coffre specification and API contract](https://app.notion.com/p/3f8fb8942376814ca6e0d313633cb11d)
describes the shared rules. TypeBox contracts live in
`apps/api/src/modules/coffre/schemas.ts`.

| Request | Result |
| --- | --- |
| `GET /api/coffre` | Guest state: `unprepared`, `prepared`, `collecting` or `revealed`, with `serverNow`, `durationSeconds`, `startedAt` and `deadline` |
| `GET /api/organizer/coffre` | Same state for the organizer |
| `GET /api/organizer/coffres?before=ID` | Organizer-only history, newest first; metadata only, pages of 50 |
| `POST /api/organizer/coffres` | Prepare the successor with `{ "previousCoffreId": 1 }`, only after its predecessor is revealed |
| `PATCH /api/organizer/coffre?coffreId=ID` | Rename a current or archived Coffre with `{ "name": "Les secrets de minuit" }` |
| `PUT /api/organizer/coffre` | Create/configure before launch with `{ "durationSeconds": 21600 }`; allowed bounds are 1–604800 seconds |
| `POST /api/organizer/coffre/start` | Start with `{}`; retries preserve the original deadline |
| `POST /api/organizer/coffre/advance` | Shorten the collecting period with `{ "deadline": "ISO_DATE_TIME" }`; must be future and earlier than the current deadline |
| `POST /api/organizer/coffre/open` | Open immediately with `{}` while collecting; repeated calls preserve the opening time |
| `POST /api/coffre/contributions` | Guest deposit while collecting |
| `POST /api/organizer/coffre/contributions` | Organizer deposit while prepared or collecting |
| `GET /api/tv/coffre` | Authenticated TV state for the latest Coffre |
| `GET /api/tv/coffre/contributions?coffreId=ID&after=UUID` | TV-only content read after revelation; no authors or private data |
| `GET /api/tv/coffre/media/:id/image` | Current revealed public photo, with a dedicated TV session |
| `GET /api/tv/coffre/media/:id/thumbnail` | Same TV photo access rules |
| `GET /api/organizer/coffre/contributions?visibility=private&after=UUID` | Metadata only; both filters are optional |
| `GET /api/organizer/coffre/contributions/:id` | Explicit content read |
| `DELETE /api/organizer/coffre/contributions/:id` | Idempotent deletion without a prior content read |

State responses also contain `id` (null before the first preparation) and `name`
(null for the default numbered label). Names contain 1–80 Unicode code points,
are trimmed before storage and can be changed only by the organizer. Renaming
changes neither the countdown nor contribution ownership. Guests see the current
name; the organizer also sees names in the archive selector. A successor starts
with a fresh numbered label. Migration 0008 adds a nullable name column without
rewriting existing Coffres or memories. A state
read without `coffreId` selects the latest Coffre. Add `?coffreId=ID` to state,
configuration, timing, deposit, contribution-list, detail and deletion requests
to target a specific Coffre. For compatibility, requests other than state reads
keep targeting Coffre 1 when the selector is omitted; stale clients cannot
silently submit to a successor. Both list cursors remain independent: `before`
for Coffres, `after` for contributions.

Creating a successor preserves all previous records and copies the predecessor’s
configured duration, editable before manual launch. It locks that predecessor
and creates at most one successor, so repeated or concurrent creation requests
return the same Coffre. A prepared/collecting Coffre cannot create a successor.
The UI keeps each draft and explicit retry bound to its original Coffre. Only
the organizer can browse previous Coffres. Guests automatically follow the latest
Coffre and cannot read older states, content or direct photo URLs after successor
creation, including previously public photos. Private photos remain organizer-only. Retention is still tracked in ENG-59. Migration
0007 removes the singleton restriction without moving or deleting memories.

The guest Coffre page has no content-list GET route: `GET /api/coffre/contributions`
returns 404 while POST deposits remain available during collection. TV content
reads use the dedicated `/api/tv/coffre` routes and a separate TV cookie; guest and
organizer cookies do not authorize the TV. TV media never expose private,
deleted or older-Coffre photos, or avatars, even with an organizer cookie present.
The ordinary `/api/media` routes reserve Coffre photos to the organizer and
retain existing avatar access rules.

To connect a television, open `/organisateur/coffre` and select **Afficher un code
TV**, then enter the four digits at `/coffre/tv`. The organizer generates the code
with `POST /api/organizer/tv/pairing` (JSON `{}`, organizer cookie and
`X-Organizer-Request: 1`). It replaces the previous pending code, expires after
10 minutes and allows at most five attempts in total. `POST /api/tv/session`
(JSON `{ "code": "0123" }`, `X-TV-Request: 1`) consumes it once and sets an
independent HttpOnly, SameSite=Strict cookie for seven days. Only token/code
hashes are stored. A new code pairs another screen without disconnecting already
paired screens. TV sessions are independent of guest profiles and the hub switch.
They authorize only the latest Coffre's TV state and revealed public content,
never profiles, guest deposits or organizer actions. Migration 0009 adds the two
TV access tables without changing guest data.

Guest routes require a valid guest cookie and open hub. Organizer routes use the
existing independent organizer session and `X-Organizer-Request: 1`. Every write
requires the exact configured `Origin`; guest writes also require
`X-Guest-Request: 1`. All responses are private/no-store.

A text deposit is JSON: `{ "id": "UUID_V4", "text": "A wish", "visibility":
"public", "frameId": "one-wish-willow" }`. Generate the ID once per draft and
retain it when retrying. The same normalized content/actor/photo bytes returns
the same `200 { "id": "UUID_V4", "received": true }` receipt, including after
closure. Reusing the ID with different content returns `409 CONTRIBUTION_CONFLICT`.
Receipts contain no content or individual read URL.

For a photo, send multipart with one `file` and one plain string `contribution`
field containing that JSON. Either order is supported. `text` is optional, at
most 500 Unicode code points before trimming; blank text becomes null. At least
text or a photo is required. `plain` supports text/photos; `one-wish-willow` is
text-only. No client-supplied media ID or standalone photo upload is accepted.
Use the [shared media limits](media.md#shared-media) and existing protected image routes.

Lists return `{ contributions, nextCursor }`, with at most 50 items ordered by
UUID. Pass `nextCursor` as `after` until it is null. Organizer list items contain
only ID/date/visibility/frame, content-presence booleans and author metadata;
they do not load messages, thumbnails or photo IDs.

The organizer interface at `/organisateur/coffre` prepares the duration, launches
the countdown, shortens the remaining time or opens immediately after confirmation.
It also accepts organizer deposits before launch, filters metadata by visibility,
reads content only after **Consulter**, and deletes after confirmation without
reading the content first. Private content remains reserved to the organizer.

The PostgreSQL clock and persisted deadline govern acceptance and revelation.
Timing commands and deposits lock the same Coffre row: an upload finishing after
opening cannot insert a new contribution. The configured duration stays unchanged
after advancement; the deadline is the shared authority. Advancing to the exact
current deadline acknowledges a retry; extension, pause, reset and reopening are
not supported. Immediate opening before launch returns `409 COFFRE_NOT_COLLECTING`.
Uploads recheck guest access, hub status and time in the insertion/attachment
transaction. Public reads before revelation return `409 COFFRE_NOT_REVEALED`;
new deposits after closure return `409 COFFRE_REVEALED`. There are no guest
individual-read/edit/delete or pause/reset/reopen commands. Deletion clears
content and revokes media immediately; a content-free tombstone prevents retry
resurrection. No retention purge is scheduled (ENG-59).

Verify the backend without touching local development data:

```sh
pnpm test
pnpm test:db:isolated
```

The isolated suite covers prepared/collecting/revealed access, repeated and
concurrent deposits, real photo processing, deadline lock waits, restart
persistence, pagination and deletion. It creates and removes its own temporary
PostgreSQL container and media directory.
