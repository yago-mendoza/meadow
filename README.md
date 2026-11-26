# Meadow

A local tool where **everything is nesting**: projects › areas › frames › tabs › frames | documents › pages › titles.
Drag something to another level and it converts (a `## title` dropped on a frame's tabs becomes a tab; its subtitles
become documents). Ideas and tasks hang on anything. A Notepad-like editor (CodeMirror) for the writing.

The model is in `MODEL.md`; the principles of the app and of how to work on it in `PRINCIPLES.md` (read first).

## Run

```
npm install
node server.mjs --open        # or double-click Meadow.vbs on Windows (no window)
```

It serves http://localhost:5240 (only on this machine). The start screen lists your projects: new, open a folder, move one
somewhere else, or change the folder where new projects go.

## Where your data lives (never in this repo)

- **Projects**: one folder each, with `meadow.json` and a backup a day in `backups/`. By default in `Documents\Meadow`;
  any folder works, and the app can move them.
- **Configuration** (the list of projects and the default folder): `%APPDATA%\Meadow\config.json`.
- Overrides: `MEADOW_PORT`, `MEADOW_HOME` (configuration folder), `MEADOW_ROOT` (default projects folder).
  `MEADOW_DATA` points to an old single-board folder, brought in as the first project on the first run.

## Develop

- After changing `src/editor.js`: `npm run build` → `public/editor.bundle.js`.
  `@codemirror/view` is pinned to 6.43.15 (6.44.1 logs every DOM event to the console).
- `public/app.js` (the tree, the stage, the map, the drawer, the linker), `public/tree.css`, `public/style.css` (the editor's
  writing style), `public/motion.js` (how things move), `server.mjs` (projects and their files).
- Tests drive a headless browser over CDP against a server started with `MEADOW_HOME`/`MEADOW_ROOT` pointing to a scratch
  folder; `window.meadow.S` exposes the state.
