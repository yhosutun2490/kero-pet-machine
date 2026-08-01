# Shell owns connection state; Views are disposable presentational surfaces

The Chatboard window swaps between Views (Practice, Settings) by conditional
render, so the inactive View unmounts. To keep switching Views from ever
dropping a live conversation, the durable state — the conversation lifecycle
machine, the WebRTC connection to Kero, the audio output element, and the
current settings — lives in the **Shell**, not in any View. Each View is a pure
presentational surface that reads Shell state and dispatches events; unmounting
it disturbs nothing.

## Considered options

- **Shell owns state, Views are disposable (chosen).** Simplest render model
  (`activePage ? <PracticeView/> : <SettingsView/>`), no router, and a live call
  survives navigation because nothing it depends on lives in the unmounted View.
- **Keep both Views mounted, hide the inactive one with CSS.** Only needed if
  connection state were trapped inside a View. It isn't, so this just keeps
  extra DOM around.
- **Add a router and treat Views as routed pages.** Buys history/URLs the window
  has no address bar to use; rejected (see the "View, not Page" naming in
  `CONTEXT.md`).

## Consequences

- Any new View is presentational by construction — if a future View needs to
  own durable state, that state must be lifted into the Shell instead, or this
  invariant breaks and navigation can drop the connection.
- The prefactor that extracts `ChatPage` from `ChatboardApp` exists solely to
  establish this boundary and must land before the sidebar.
