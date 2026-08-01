# Chatboard Sidebar + Settings View — Design

**Date:** 2026-08-01
**Status:** Approved (grilled)
**Related:** `CONTEXT.md` (glossary), `docs/adr/0001-shell-owns-connection-state.md`

## Problem

The Chatboard window (`ChatboardApp`) has a single screen: the conversation
practice UI. The user wants a left sidebar to navigate between two **Views** —
**語言練習** (Practice) and a new **設定** (Settings) — where the Settings View
lets the learner choose the realtime **model** and the **voice** (grouped by
男/女). Those choices must flow into the OpenAI Realtime session.

Terminology note: these are **Views**, not pages — there is no router, no URL,
no back/forward. See `CONTEXT.md`.

## Decisions (from brainstorming + grilling)

- **Navigation:** in-window Views toggled by Shell state. No routing library.
- **Sidebar:** shadcn `sidebar` component (fallback: lightweight `<aside>`).
- **Render:** conditional render — the inactive View unmounts. Safe because all
  durable state lives in the Shell (ADR-0001).
- **Model options:** `gpt-realtime` and `gpt-realtime-mini`.
- **Voice groups (男/女):** 男 = `ash`/`cedar`/`verse`, 女 = `marin`/`coral`/`sage`.
  A UI grouping over voice names, not a guarantee of gender.
- **Settings apply via a Save button** (draft + dirty), NOT live-on-change.
- **On Save:** persist to `localStorage`, and if a conversation is live/connecting,
  reconnect with the new model/voice.
- **Reconnect keeps the on-screen transcript** and does **not** re-greet.
- **Unsaved draft is discarded** when leaving the Settings View.
- **No react-hook-form** — two whitelisted fields; hand-crafted state.

## Architecture

**Principle (ADR-0001): the Shell owns connection state; Views are pure
presentational surfaces.** Unmounting a View never disturbs a live conversation.

### Components

- **`ChatboardApp` (Shell)** — owns the durable state:
  - the `chatMachine` (`snapshot`/`send`),
  - `connRef`, the hidden `<audio>` element, PTT handlers, `keroInterim`,
  - `settings` (via `useSettings`),
  - `activeView` state (`'practice' | 'settings'`, default `'practice'`).
  Renders the sidebar + the active View via conditional render. Switching Views
  never tears down the connection.

- **Sidebar** — the shadcn `sidebar` component (`npx shadcn add sidebar`,
  base-nova/base-ui style). Adds `src/components/ui/sidebar.tsx` and its deps
  (Sheet, Tooltip, Separator, Skeleton, `useIsMobile`, etc.). The Shell wraps
  content in `<SidebarProvider>` and renders a `<Sidebar>` with a `<SidebarMenu>`
  of two `<SidebarMenuButton>` items: 🐸 語言練習 / ⚙️ 設定 (lucide icons),
  driving `activeView` via `isActive` + `onClick`.
  - **Verify at implementation time:** confirm `shadcn add sidebar` resolves
    against the base-nova registry and its deps install cleanly (`npm run
    typecheck` + app boots). If unavailable or it drags in Radix that clashes
    with `@base-ui/react`, fall back to a lightweight custom `<aside>` nav built
    from the existing `Button`/tokens — same two-item behaviour, so the rest of
    the design is unaffected.

- **`ChatPage` (Practice View)** — presentational. Props: `snapshot`, `send`,
  `pttDown`, `pttUp`, `keroInterim`. Contains the current chat JSX moved
  verbatim. The `<audio>` element stays in the Shell.
  - **Mid-recording navigation:** if the user leaves the Practice View while
    push-to-talk is active, the recording auto-ends (equivalent to releasing the
    mic — `stopTalking` + clear speaker). Cleanly handled on unmount / on the
    Shell's view-change, so no dangling open audio buffer.

- **`SettingsPage` (Settings View)** — presentational. Props: `saved`
  settings, `onSave(draft)`.
  - Holds local **draft** state initialised from `saved`.
  - Model: radio group, 2 options (`gpt-realtime`, `gpt-realtime-mini`).
  - Voice: a 男/女 group toggle; selecting a group reveals that group's voices,
    the user picks one → a single `voice` string. Changing group/voice only
    mutates the draft (no reconnect).
  - `isDirty = draft.model !== saved.model || draft.voice !== saved.voice`.
  - **儲存 (Save) button**, `disabled={!isDirty}` → calls `onSave(draft)`.
  - Draft lives inside this View, so leaving the View (unmount) discards any
    unsaved changes; re-entering shows `saved` again.
  - No validation layer needed — the radio/group options are the whitelist, so
    an illegal value cannot be constructed.

### Settings state — `useSettings()`

A hook backed by `localStorage` (key `kero.settings`).

```ts
interface Settings { model: string; voice: string }
```

- Default: `{ model: 'gpt-realtime', voice: 'cedar' }` (current behaviour).
- On init, reads/validates stored JSON against the known model + voice
  whitelists; on parse error or unknown value, falls back to default (so a stale
  stored value never reaches the server).
- Returns `[settings, setSettings]`; `setSettings` writes through to
  `localStorage`.

Voice-group constants (`MALE_VOICES`, `FEMALE_VOICES`) and `MODELS` live in a
shared client module so the Settings UI and `useSettings` validation reference
one source. The server keeps its own copy (tested) — see below.

### Client seam — `src/lib/realtime.ts`

- `getRealtimeSession(lang, opts: { model: string; voice: string })` — adds
  `model` and `voice` to the POST body to `/session`.
- The Shell's connect effect reads the current `settings` and passes them to
  `getRealtimeSession`. `settings` is a dependency so a reconnect uses the
  latest saved values.

### Server — `server/src/session.ts` + route

- `buildSessionBody(lang, opts: { model: string; voice: string })`:
  - Whitelist `model` ∈ {`gpt-realtime`, `gpt-realtime-mini`}.
  - Whitelist `voice` ∈ 男 ∪ 女 groups.
  - Unknown value → the pure builder throws; the route maps to **400**. No
    silent fallback, so a bad client is visible.
  - Uses the validated `model` for `session.model` and `voice` for
    `session.audio.output.voice` (currently hardcoded `gpt-realtime` / `cedar`).
- The `/session` route parses `model` + `voice` alongside `lang`, validates,
  returns 400 on invalid input.
- **Verify at implementation time:** `gpt-realtime-mini` must be a real model id
  accepted by `client_secrets`. If it is not, drop that option and ship only
  `gpt-realtime` (single-model radio). This is a fact to confirm, not a decision.

### Save + reconnect

- Add a `RECONNECT` event to `chatMachine`. From `live` **and** `connecting` it
  transitions to `connecting` (re-entering the connect effect).
- `SettingsPage.onSave(draft)` → Shell:
  1. `setSettings(draft)` (persists to `localStorage`), then
  2. if the machine is in `live` or `connecting`, `send({ type: 'RECONNECT' })`.
- The existing effect that tears down `connRef` when leaving `live` disposes the
  old connection; the connect effect rebuilds it with the new model/voice.
  Reconnect passes `greet: false` (no re-introduction mid-conversation) and does
  **not** clear `context.messages` (the transcript stays on screen). The new
  realtime session has no memory of prior turns — accepted.
- If the machine is still on `selectingLanguage` (not yet connected), Save only
  persists; the new settings apply on the next connect.

## Data flow (Save while live)

```
SettingsPage: user edits draft → clicks 儲存 (isDirty)
  → Shell onSave(draft)
      → setSettings(draft) (→ localStorage)
      → (if live|connecting) send RECONNECT
          → machine: → connecting
          → teardown effect disposes old connRef
          → connect effect: getRealtimeSession(lang, {model, voice})
              → POST /session {lang, model, voice}
              → server validates + buildSessionBody → mintSession
          → connectRealtime({ greet: false, ... }) → new connRef
          → CONNECTED → live   (transcript unchanged)
```

## Testing (TDD)

- **Server** (`server/src/session.test.ts`): `buildSessionBody` uses the
  provided model + voice; throws on unknown model; throws on unknown voice.
  Route returns 400 on invalid model/voice.
- **`useSettings`**: default when storage empty/corrupt/unknown value; persists
  writes; reload reads persisted value.
- **`chatMachine`** (`chatMachine.test.ts`): `RECONNECT` from `live` →
  `connecting`; from `connecting` → `connecting`; ignored from
  `selectingLanguage`.
- **Prefactor** keeps every existing suite green with no behavioural diff;
  `npm run typecheck` clean throughout.

## Out of scope (YAGNI)

- No routing library / URL navigation.
- No react-hook-form (two whitelisted fields).
- No per-language voice defaults.
- No live voice preview / sampling before Save.
- No "discard/keep unsaved changes?" prompt — leaving the View discards the draft.
- No models beyond the two listed.
