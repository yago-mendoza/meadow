# Meadow

A zoomable grid (pastel, dotted) of documents, post-its, ideas, tasks, frames and signs, with a Notepad-like editor.

- **Start:** double-click `Meadow.vbs` (or the Meadow shortcut on the desktop): it starts `node server.mjs` without a window and
  opens http://localhost:5240. Data: `data/meadow.json` (one backup a day in `data/backups/`). `MEADOW_PORT` / `MEADOW_DATA` override both.
- **Build the editor** after changing `src/editor.js`: `npm run build` → `public/editor.bundle.js`.
  `@codemirror/view` is pinned to 6.43.15: 6.44.1 logs every DOM event to the console.

## The plane
- Left bar: Documento, Post-it, Idea, Tarea, Marco, Letrero. Click: at the centre (a document opens); drag: where you drop it.
- **Click** a thing: the view centres and zooms on it, and «Volver a donde estabas» takes you back. **Double click** a document opens it.
  Click a document's or a frame's title to rename it.
- Wheel zooms around the pointer; pan with the middle or right button, Space + drag, or Ctrl + drag on empty grid.
- Drag on empty space selects; Shift/Ctrl + click adds or removes one. With two or more selected, a bar copies them all.
- **What moves with what** (Alt: only the selection): a frame carries what is inside it, frames inside it too (nested);
  a document carries the post-its, ideas and tasks lying on it; small things carry the small things they touch, except
  what lies on a document that is not moving. The corner handle scales a thing as a whole, with what it carries.
- Hover something partly covered: it comes forward (with what lies on it) while the pointer is over it. «Al frente» / «Al fondo» keep it there.
- **Tasks dropped just under a document** dock to it: stacked, as wide as the page, moving and scaling with it.
- **Frames**: dropped near loose things they wrap them; «＋» on the tab makes a frame inside; square corners.
- **Signs**: a wooden plank standing out from the nearest edge of what you drop it on, with a scribble; a click reads it.
- **Trays** (bottom left): tucked away as a pill; they come out by themselves while a document is dragged. One open at a time,
  up to four, each with its colour (click its dot), rename (double click), «⤢» puts all its documents on the plane.
- **Panel** (right): tasks (pending / done / all) and ideas, grouped by the frame they are in; history with «Restaurar»,
  «Volver a como estaba» for documents, and «Ir» / «Abrir» for pieces that still exist.
- Ctrl+V on the plane: a copied idea or task appears there; any other text becomes a post-it.

## The editor
- Index on the left (click to go). `# Title` (capitals), `## Title`, `### Title` make sections; a chevron left of each title folds
  it (to the title), and the one above them folds or unfolds all. Clicking a title's «#» (or #/##/### in the header) splits the
  text into the sections of that level: each one gets a band, a grip to drag it and buttons to copy, paste over, save as a document and fold.
- `[` suggests documents, ideas and tasks, or creates a new one; `[name*]` creates a document. A link shows its label and a ↗ that opens it.
  Ideas and tasks inside the text are the same objects as on the plane: tick or rename them anywhere.
- `[TAG]` at the start of a line colours it; `> text` is a small note; `------` is a rule; brackets, parentheses, `>>` and `::` are coloured.
- ¶ switches all of this off to see the bare text.
