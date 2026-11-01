# Invitations and guest access

[Back to the project README](../README.md)

Invitation responses, profiles, companions, personal codes and scheduled opening.

## Invitation form

The interface is in French and uses a dark theme.
`/invitation` collects a first name, attendance, a conditional +1 choice and an
optional idea. A saved response can be reopened with **Modifier ma réponse** in the
same browser. The browser preserves its random response identifier and exchanges
it for a separate protected guest cookie. Each response links to an independent
profile UUID; first names are never used to merge profiles. Recognized guests
edit their linked response through their cookie, including when the hub is closed.

The form uses the existing invitations API through the Vite proxy. Failed saves
preserve the draft and reuse the identifier on retry. Browser storage must be
available so a saved response can be recovered after a reload.

### Guest hub and access

The distributed root URL remains valid. `/` opens the hub only for a recognized
guest while the organizer's **Accueil du site** switch enables it; otherwise it
redirects to `/invitation`. The switch defaults to Invitations and persists in
PostgreSQL. Closing the hub preserves guest access and invitation editing.
Guest cookies last 90 fixed days without inactivity expiry. They are HttpOnly,
SameSite=Strict and Secure over HTTPS; only token fingerprints are stored in the
database. Guest and organizer sessions are independent.

The hub uses the current profile first name. `/profiles` lets recognized guests
edit that name inline next to their avatar; the save control appears only after
a name change. Guests can import or take a photo, then preview/crop it in a modal,
replace it or remove it. Name
changes update Invitations without changing attendance, +1 or ideas. Avatar
previews use browser decoding. The modal supports mouse/touch dragging, wheel
zoom and two-finger pinch, with keyboard and +/- button alternatives. Camera
streams stop after capture or cancellation, including late permission responses.
On HTTP LAN development origins, the camera action uses native mobile capture
instead of getUserMedia. A browser that cannot preview HEIC still allows
upload with the server's centered square crop. Processing and format/size limits
remain authoritative on the API. `/profiles` redirects to Invitations while the
hub is closed. Coffre is available from the hub at `/coffre`.

Eligible main guests (attendance other than no, +1 selected) can create and copy
a seven-day companion link from their profile. The companion opens it on their
own browser, enters their name, then optionally adds an avatar. This creates an
independent profile/session without a personal invitation response. The route is
`/companions/$mainProfileId#token=SECRET`; the secret stays in the fragment and is
sent only in the claim JSON body, never in an HTTP URL or browser storage. It is
removed from the address bar after successful creation. Generating a replacement
link invalidates the previous one; a claimed companion is displayed by name and
prevents a second creation. Reloading restores access from the guest cookie.
An already recognized browser keeps its identity and offers to continue with it.
Existing guests who lost access can use `/login` instead of creating a new profile.

`GET /api/profiles/me/companion` requires a guest session and open hub. It returns
`{ eligible, companion: { firstName } | null }` for that guest's relation only;
it grants no editing or media access to the other person. The existing claim
endpoint atomically rechecks eligibility, uniqueness and link expiry.

The [guest access contract](https://app.notion.com/p/3f9fb89423768126bfdade067dcea4c1)
holds the profile, companion, session and code-login decisions. Profile deletion
remains separate; merging code does not perform a production operation.

Action confirmations and request failures use themed [Sonner](https://sonner.emilkowal.ski/)
toasts shared by guest and organizer pages. Field validation remains attached to
its input; loading states, saved-response summaries and required recovery
instructions remain on the page. Photo modals have their own notification host
so feedback stays accessible above the native dialog's backdrop. Camera photos
remain local until the guest confirms upload.

HTTP LAN previews generate a secure UUID v4 with `crypto.getRandomValues()` when
`crypto.randomUUID()` is unavailable. The identifier is still persisted before
the first request and reused on retry. A phone preview requires an exact
`APP_ORIGIN` matching its network URL and Vite `--host`; organizer access must
remain disabled for a non-loopback HTTP origin or use HTTPS. This does not change
the production origin or cookie rules.

### Personal guest codes

In the protected organizer dashboard, open **Invités**
(`/organisateur/acces`). Every main or companion profile has its own entry.
Generate a code and transmit it to that person through your chosen channel;
the app does not send messages. The clear code is shown only after generation,
can be selected/copied, and disappears on hiding it or leaving the page.
It cannot be retrieved later: regenerate it if lost.

Guests follow **Retrouver mon profil par code** from Invitations or open
`/login`. A successful login restores the existing profile and its linked
response without a new submission. It opens the hub if enabled, otherwise
Invitations. Recognized browsers can continue with their current identity;
the API refuses to switch silently to another profile (`409
PROFILE_ALREADY_IDENTIFIED`). Companions retain their independent access
without a personal Invitations response.

New personal codes contain four random decimal digits, including leading zeros.
Issuance is serialized and retries occupied values, so two profiles cannot receive
the same code and regeneration always changes the previous code. Retired fingerprints
remain reserved independently of profiles, so an old code cannot later identify
someone else, including after profile removal. Only SHA-256 fingerprints and the
current code's enabled state are stored. Previously distributed 20-character
codes remain accepted until Chris regenerates them from Organizer → Invités; they
cannot be shortened from their stored fingerprints. Input still ignores case,
whitespace and hyphens for compatibility. Codes are reusable until replaced or disabled. Login establishes
the existing protected 90-day guest session; codes never enter guest URLs,
localStorage or profile responses.

Regenerating invalidates the old code and preserves open sessions.
**Désactiver l’accès** disables the code, revokes every session of that profile,
and blocks legacy response-UUID exchange. Historical invitation access does not
re-enable it. Generating a new code enables access again; revoked sessions do
not return. These operations do not delete the profile, response, companion
relation or media.

Search for a guest by first name in the same section. **Supprimer le profil**
opens a confirmation naming the person, the related guest and the consequences.
The short profile reference distinguishes namesakes. Confirmation soft-deletes
the profile, revokes codes/sessions and hides its invitation response from the
organizer list/totals. Old response UUIDs can no longer read, save or restore
that profile, and generating a code cannot reactivate a removed profile.
Repeated deletion is safe to retry.

Removing a companion frees the main's slot and invalidates the old creation
link; the main can generate a fresh one. The main's declared attendance and
plus-one choice stay unchanged. Removing a main preserves the former
companion's independent profile and access. Totals still count submitted
invitation responses, not standalone profiles. Stored responses/links remain
internal tombstones; Coffre contributions, authorship and media are retained
with their existing visibility rules. Contribution deletion stays separate.

API operations:

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/api/guest-access/login` | JSON `{ "code": "…" }`; guest access envelope and protected session cookie |
| GET | `/api/organizer/profile-access` | Profile IDs/names/roles and code/access status; no code or fingerprint |
| POST | `/api/organizer/profiles/:profileId/code` | Generate or replace; returns the clear code once |
| DELETE | `/api/organizer/profiles/:profileId/code` | Disable code/access and revoke sessions; HTTP 204 |
| DELETE | `/api/organizer/profiles/:profileId` | Remove the profile, unlink its companion relationship, revoke access, retain memories; HTTP 204 |

Guest login requires the exact `Origin`, `X-Guest-Request: 1` and JSON.
Organizer operations require the organizer session and
`X-Organizer-Request: 1`; writes also require the exact `Origin`.
All responses use `Cache-Control: no-store`. Invalid and disabled codes return
the same `401 INVALID_GUEST_CODE`. Malformed JSON/fields are rejected before
credential lookup. Database failures remain generic errors.

PostgreSQL enforces atomic budgets of five attempts per normalized candidate
fingerprint and 100 total attempts in each fixed UTC five-minute window.
Successful attempts count too. Exceeding either budget returns
`429 LOGIN_RATE_LIMITED` with `Retry-After` until the window ends. Counters
survive API restarts; expired candidate rows are removed on the next admitted
attempt, and the global budget bounds their growth.

## Scheduled guest opening

Guest `/coffre` and `/missions` redirect to `/a-ce-soir` until 31 October 2026
at 21:00 Europe/Paris (20:00 UTC). The page preserves the requested destination
and resumes it automatically after the server reports opening. Browser clock
changes cannot unlock activity data: the API rejects all guest Coffre/Missions
requests with `403 PARTY_NOT_OPEN` before the same instant. Waiting/status reads
are not cached; a failed check keeps activity content hidden.

Organizer preparation and the separately paired TV remain available. Invitations,
profiles and login keep their existing access rules. No database data is reset.

`PARTY_OPENS_AT` optionally sets an absolute ISO timestamp with an explicit timezone;
its default is `2026-10-31T20:00:00.000Z`. This is a one-time opening, not a daily
schedule. Local/CI integration fixtures explicitly use an already-open timestamp;
leave the default for the party. Production Compose passes the setting to the API.
Changing an operator setting requires restarting that environment's API.
