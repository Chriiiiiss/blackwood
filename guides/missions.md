# Secret missions

[Back to the project README](../README.md)

Assignments, recipient confirmations, scoring and TV celebrations.

## Secret missions

Guests open `/missions` from the hub using their existing profile and session.
Each player explicitly draws one private mission at a time from the server's
75-mission catalog. Text starts blurred, can be revealed/hidden freely and is
hidden again on navigation or when the browser tab becomes hidden. Reveal state
and mission text are never stored in localStorage. Incoming confirmations take
priority: guests must confirm or reject every pending request before their own
mission or completed history is displayed. There is no separate confirmation tab.
The page checks requests first and keeps personal missions hidden if that check
fails; a newly received request interrupts an already open mission and re-blurs
it when the guest returns.

After completing the trick, the player chooses another participating guest and
requests confirmation. Only that recipient can confirm or reject; a confirmed
mission earns one point. The sender can cancel an undecided request. Rejections
and cancellations preserve the same mission. Drawing the next mission requires
an explicit action; completed missions do not repeat for that profile.

The API owns assignments, pending claims and confirmed scores in PostgreSQL.
Draws carry a stable UUID and predecessor assignment ID; claims carry a stable
UUID. Retrying an uncertain request cannot draw a later mission or count a
second point. Main guests and companions participate independently. Scores and
history survive API restarts and successive Coffres. Removed profiles disappear
from the leaderboard, while disabling access preserves earned points.

The paired TV reads `/api/tv/missions/leaderboard` separately every five seconds.
A compact upper-left panel lists rank, first name and points, rotating five rows
at a time for larger groups. No mission text or guest access identifier enters
this response. Scores accompany the countdown; Organizer → Coffre →
**Afficher le classement avec les souvenirs** controls their visibility after
revelation (default off). The setting persists across restarts. Score updates
and failures do not restart the Three.js scene.

During the countdown, newly observed score increases trigger a four-second
notification below the panel. Players who overtake others move above the
displaced rows with a brief bounce; a new sole leader gets an orange accent.
The TV-only opaque player ID keeps equal first names and renames independent,
without exposing private profile UUIDs. Successes observed in one poll are
queued, and multiple points for one player are grouped. First load, reload,
reconnection after an error and returning to a hidden tab establish a fresh
baseline instead of replaying old points. Celebrations stop after revelation;
the existing organizer setting still controls the score panel. Reduced-motion
preferences disable movement. No sound or mission text is broadcast.
