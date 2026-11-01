# TV and Spotify

[Back to the project README](../README.md)

Pairing a display, the Three.js scene, browser wake lock and optional music metadata.

## Coffre television

Open `/coffre/tv` on the display browser. Enter the four-digit TV code from the organizer Coffre page; the
dedicated TV session restores access on reload for seven days. The
projection uses the dedicated TV API and follows only the latest Coffre, including
its name and the server deadline. No contribution or photo is requested before
the server reports revelation. State is checked every three seconds; content and
deletions refresh every five seconds. A hidden tab suspends and clears the scene,
then verifies access again before showing content. Authentication or network
failures hide stored content and offer reconnection.

One Three.js renderer uses a perspective camera and the existing Classic and
One Wish Willow models. Memories drift and tumble independently throughout the
full viewport at different depths. Every few seconds a randomly chosen memory
moves toward the camera, faces the audience for 10–45 seconds according to text
length, then returns to the moving crowd. A shuffled queue gives every public
memory a turn; content refreshes preserve unchanged objects and their motion.
Long focused messages also have a readable transcription. Reduced-motion
preferences keep background objects still and skip travel animation.

Models enter progressively with at most two background loads at a time. Up to
24 models remain in the scene; larger collections introduce additional memories
individually as their focus turn comes, preserving the surrounding crowd. TV
textures are capped at 1024 pixels and the drawing buffer at a 1920-pixel longest
edge. Removed/changed models release geometry and textures immediately. Only
resident/focusing photos are fetched through the protected TV API. All public
UUID-cursor pages participate; authors, avatars, private memories and older
Coffres are never requested. Unsupported/lost WebGL gets an explicitly labelled
readable fallback and a retry control. Fullscreen uses the browser API.

The scene uses continuous full-screen motion rather than fixed batches of cards.

## TV screen wake lock

On `/coffre/tv`, **Garder l’écran allumé** requests a browser Screen Wake Lock
only after an explicit click. The button shows when the browser accepted the
request; this does **not** prove that a TV manufacturer’s OLED protection is
suppressed. Test on the actual television for at least two minutes.

The request requires HTTPS (or a browser-trusted loopback context) and browser
support. Unsupported or refused requests produce a toast without interrupting
the projection. The lock is released while the page is hidden or after navigation;
returning to the visible TV page requests it again only if it was enabled. A
system revocation while visible leaves it off until the user explicitly retries.
There is no simulated remote input, video fallback or automatic retry loop.

While waiting for memories, eight soft purple/orange lights drift through the
existing Three.js scene and the countdown moves gently. This adds visible motion
without another renderer; the lights hide when memories are shown. Reduced motion
disables both effects. Movement alone is not proof that Samsung's OLED protection
will stay off; the actual television test remains necessary.

## Spotify on the TV

In `/organisateur/coffre`, the organizer can authorize one Spotify account for
the paired TV screens. Playback stays on the usual Spotify device. Each new
playing track displays its original square cover, title, artists and a Spotify
link for six seconds, alongside the countdown or floating memories. Polling,
pausing and resuming the same track do not replay its alert. Reduced motion
disables decorative animations. Spotify failures hide only the music alert.

An existing Spotify Developer application can be reused; its name is shown on
Spotify's consent screen. Development mode is sufficient for this private use:
the app owner needs Premium and the account must be authorized in its dashboard.
No public quota extension or playback SDK is needed. See Spotify's
[quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

1. In the [Developer dashboard](https://developer.spotify.com/dashboard), enable
   Web API and register the exact redirect URI
   `https://halloween.sirhc.xyz/api/organizer/spotify/callback`.
   Local consent requires an additional URI matching the review server's HTTPS
   origin, followed by `/api/organizer/spotify/callback`. Spotify also accepts
   HTTP explicit loopback IP addresses, but not `http://localhost`.
2. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` together in the private
   backend environment. Leave both empty to disable the integration. Never put
   them in Vite variables or Git. Configuration and deployment on the VPS require
   separate explicit authorization, as with other production operations.
3. Sign in to the organizer, open Coffre and choose **Connecter mon compte
   Spotify**. Consent requests only `user-read-currently-playing`. Start playing
   music in Spotify; paired TV screens receive metadata within about five seconds.

The server uses Authorization Code flow with a ten-minute, one-use browser state
bound to the initiating organizer session. The cross-site callback uses a
separate HttpOnly, SameSite=Lax state cookie; organizer cookies stay Strict.
Logging out or disconnecting during authorization prevents a late callback from
restoring access. A server restart cancels unfinished consent, which can be retried.
Completed grants survive restarts in the singleton `spotify_connection` table
(migration `0014`), encrypted using AES-256-GCM and a key derived from the private
app credentials. Changing those credentials requires reconnecting Spotify.

The API automatically refreshes access tokens. All screens share one in-flight
Spotify read and a five-second server cache; Spotify's `Retry-After` is respected.
Only paired TV sessions can read `/api/tv/spotify/current`; no OAuth token, guest
identifier or playback control is exposed to the browser. Empty, paused, ad or
non-track playback produces no alert. **Déconnecter Spotify** removes the stored
grant locally; Spotify's account settings can also revoke the app authorization.
Unconfigured servers return `{ "track": null }` without contacting Spotify.

Automated provider tests simulate Spotify responses and exercise the real API,
database, consent callback and browser UI. Real-account verification still
requires private app credentials and interactive consent; automated container
checks do not contact Spotify.
