# Kero Desktop Pet

Kero is a tiny React + Tauri desktop pet using the upgraded v2 Kerolet spritesheet.

## What It Does

- Stays fixed at the bottom of the screen.
- Plays idle, waving, jumping, and review actions in place.
- Keeps acting on its own without tracking the mouse.
- Renders at 50% size in a transparent, borderless window.
- Crouches down at the bottom of the screen when clicked, then wakes up and resumes actions on the next click.
- Touching or pressing Kero does not pause autonomous actions.

## Run

```bash
npm install
npm run tauri:dev
```

For browser-only preview:

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Notes

The behavior is reducer-based in `src/keroMachine.js`. That keeps the movement and animation logic testable without launching a desktop window. The sprite asset lives at `public/kerolet-spritesheet.webp`.
