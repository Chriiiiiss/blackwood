# Coffre guest UX proposal

This is an interactive design proposal requested by Chris, not an approved change
to the production guest flow. With the development server running, open
`/design/coffre-ux/index.html`. It is a separate Vite HTML entry and is not included
in the normal application build. It imports the real Three.js model preview.

The proposal prioritizes the selected model, uses compact frame choices, clarifies
that collection is open while revelation is pending, and moves visibility to the
confirmation step. A successful simulation resets the form directly with a toast.
The countdown is fictional; no API requests or deposits occur. Files remain in
memory and object URLs are revoked by the existing hook.

For review: model/control size, text placement on mobile, long-message reading,
and whether immediate form reset is preferable to an explicit new-deposit action.
These choices remain proposals. Preserve the real flow's idempotent retry identity,
server-authoritative deadline/access, private-media protection and no individual
guest read/edit/delete after receipt when implementing any accepted design.

One Wish Willow artwork/font attribution remains in
`src/features/coffre/themes/one-wish-willow/README.md`.
