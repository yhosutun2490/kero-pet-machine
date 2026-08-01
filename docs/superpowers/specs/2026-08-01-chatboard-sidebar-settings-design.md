# Chatboard Sidebar + Settings Page — Design

**Date:** 2026-08-01
**Status:** Approved (pending spec review)

## Problem

The language window (`ChatboardApp`) has a single view: the conversation
practice UI. The user wants a left sidebar to navigate between two pages —
**語言練習** (the existing chat) and a new **設定** page — where the settings
page lets the learner choose the realtime **model** and the voice **gender**
(男/女). Those choices must flow into the OpenAI Realtime session.

## Decisions (from brainstorming)

- **Model options:** `gpt-realtime` and `gpt-realtime-mini`.
- **Voice:** grouped by gender; the user picks a specific voice within a group.
  - 男 = `ash`, `cedar`, `verse`
  - 女 = `marin`, `coral`, `sage`
- **Persistence + effect:** settings persist to `localStorage` **and** changing
  them immediately reconnects the current session with the new model/voice.

## Architecture

**Principle: the shell owns connection state; pages are presentational views.**

Today `ChatboardApp` holds the XState machine, the WebRTC connection
(`connRef`), the audio element, and the push-to-talk handlers. If chat logic
lived inside a "practice page" component, navigating to 設定 and back would
unmount it and drop the live realtime connection. Therefore the shell keeps all
stateful lifecycle, and pages are pure views.

### Components

- **`ChatboardApp` (shell)** — owns:
  - the `chatMachine` (`snapshot`/`send`),
  - `connRef`, the hidden `<audio>` element, PTT handlers, `keroInterim`,
  - `settings` (via `useSettings`),
  - `activePage` state (`'practice' | 'settings'`, default `'practice'`).
  Renders `<Sidebar>` + the active page. Switching pages never tears down the
  connection (both pages stay mounted or only the presentational view swaps;
  the machine and `connRef` live in the shell regardless).

- **Sidebar** — the **shadcn `sidebar` component** (`npx shadcn add sidebar`,
  base-nova/base-ui style). This adds `src/components/ui/sidebar.tsx` and pulls
  its dependencies (Sheet, Tooltip, Separator, Skeleton, `useIsMobile` hook,
  etc.). The shell wraps content in `<SidebarProvider>` and renders a `<Sidebar>`
  with a `<SidebarMenu>` of two `<SidebarMenuButton>` items: 🐸 語言練習 /
  ⚙️ 設定 (lucide icons), driving `activePage` via `isActive` + `onClick`.
  No routing library.
  - **Verification at implementation time:** confirm `shadcn add sidebar`
    resolves against the base-nova registry and its deps install cleanly
    (`npm run typecheck` + app boots). If the component is unavailable or drags
    in Radix that clashes with `@base-ui/react`, fall back to a lightweight
    custom `<aside>` nav built from the existing `Button`/tokens — same two-item
    behaviour, so `ChatPage`/`SettingsPage`/state design is unaffected.

- **`ChatPage`** — presentational. Props: `snapshot`, `send`, `pttDown`,
  `pttUp`, `keroInterim`. Contains the current chat JSX moved verbatim
  (language selection, message list, interim bubble, PTT/end/restart controls,
  error line). The `<audio>` element stays in the shell.

- **`SettingsPage`** — presentational. Props: `settings`, `onChange`.
  - Model: radio group with 2 options (`gpt-realtime`, `gpt-realtime-mini`).
  - Voice: a 男/女 gender toggle; selecting a gender reveals that group's
    voices, and the user picks one. Result is a single `voice` string.

### Settings state — `useSettings()`

A hook backed by `localStorage` (key e.g. `kero.settings`).

```ts
interface Settings { model: string; voice: string }
```

- Default: `{ model: 'gpt-realtime', voice: 'cedar' }` (current behaviour).
- Reads/validates stored JSON on init; falls back to default on parse/shape
  error.
- Returns `[settings, setSettings]`; `setSettings` writes through to
  `localStorage`.

Voice-group constants (`MALE_VOICES`, `FEMALE_VOICES`) live in a shared module
so both the SettingsPage UI and the server whitelist reference the same list
(or at least a duplicated-but-tested constant on the server side).

### Client seam changes — `src/lib/realtime.ts`

- `getRealtimeSession(lang, opts: { model: string; voice: string })` — adds
  `model` and `voice` to the POST body to `/session`.
- The connect effect in the shell reads the current `settings` and passes them
  to `getRealtimeSession`. `settings` becomes a dependency so a change while
  connecting uses the latest values.

### Server changes — `server/src/session.ts` + route

- `buildSessionBody(lang, opts: { model: string; voice: string })`:
  - Whitelist `model` ∈ {`gpt-realtime`, `gpt-realtime-mini`}.
  - Whitelist `voice` ∈ male ∪ female groups.
  - Unknown value → reject (route returns **400**); no silent fallback so a
    bad client is visible. (Alternatively the pure builder throws and the route
    maps to 400 — same effect.)
  - Uses the validated `model` for `session.model` and `voice` for
    `session.audio.output.voice` (currently hardcoded `gpt-realtime` / `cedar`).
- The `/session` route parses `model` and `voice` from the request body
  alongside `lang`, validates, and returns 400 on invalid input.

### Immediate reconnect

- Add a `RECONNECT` event to `chatMachine`. From `live` **and** `connecting` it
  transitions to `connecting` (re-entering the connect effect).
- When `SettingsPage.onChange` fires, the shell:
  1. persists via `setSettings`, then
  2. if the machine is in `live` or `connecting`, `send({ type: 'RECONNECT' })`.
- The existing effect that tears down `connRef` when leaving `live` disposes the
  old connection; the connect effect rebuilds it with the new model/voice. No
  new teardown logic is required.
- If the user is still on `selectingLanguage` (not yet connected), changing
  settings just persists — nothing to reconnect.

## Data flow

```
SettingsPage.onChange
  → shell setSettings (→ localStorage)
  → (if live|connecting) send RECONNECT
      → machine: → connecting
      → teardown effect disposes old connRef
      → connect effect: getRealtimeSession(lang, {model, voice})
          → POST /session {lang, model, voice}
          → server validates + buildSessionBody → mintSession
      → connectRealtime(...) → new connRef → CONNECTED → live
```

## Testing (TDD)

- **Server** (`server/src/session.test.ts`): `buildSessionBody` uses provided
  model + voice; rejects unknown model; rejects unknown voice. Route returns
  400 on invalid model/voice.
- **`useSettings`**: returns default when storage empty/corrupt; persists writes
  to `localStorage`; reload reads persisted value.
- **`chatMachine`** (`chatMachine.test.ts`): `RECONNECT` from `live` →
  `connecting`; `RECONNECT` from `connecting` stays/returns `connecting`;
  ignored from `selectingLanguage`.
- Existing suites (`realtime.test.ts`, machine tests) stay green;
  `npm run typecheck` clean.

## Out of scope (YAGNI)

- No routing library / URL-based navigation (single window, two views).
- No per-language voice defaults.
- No live preview / sampling of a voice before selecting.
- No additional models beyond the two listed.
