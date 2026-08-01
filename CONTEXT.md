# Context — Kero Desktop Pet

Glossary of domain terms. Definitions only — no implementation details.

## Chatboard window

- **Chatboard window** — the single Tauri window that hosts the language
  conversation experience. It has no address bar and no browser history.

- **View** (分頁) — one of the swappable screens inside the Chatboard window.
  A View is *not* a routed page: there is no URL, no back/forward, no deep
  link. Views are toggled by in-window state only. Current Views:
  - **Practice View** (語言練習) — the live voice conversation with Kero.
  - **Settings View** (設定) — where the learner chooses the model and voice.

- **Shell** — the frame of the Chatboard window. It owns the durable state:
  the conversation lifecycle, the live connection to Kero, the audio output,
  and the current settings. The Shell decides which View is shown. A View is a
  presentational surface only; unmounting a View never disturbs anything the
  Shell owns (so switching Views never drops a live conversation).

- **Voice gender** (男/女) — a grouping of the available Kero voices into
  男 (male-leaning) and 女 (female-leaning) sets, offered as a convenience for
  the learner. It is a UI grouping over OpenAI voice names, not a guarantee.
