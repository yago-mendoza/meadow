# Meadow

A zoomable grid (AutoCAD-like, pastel) of documents, post-its and frames, with a Notepad-like editor.

- **Start:** double-click `Meadow.vbs` (starts `node server.mjs` without a window and opens http://localhost:5240).
  Data: `data/meadow.json` (one backup a day in `data/backups/`). `MEADOW_PORT` / `MEADOW_DATA` override both.
- **Build the editor** after changing `src/editor.js`: `npm run build` → `public/editor.bundle.js`.
  `@codemirror/view` is pinned to 6.43.15: 6.44.1 logs every DOM event to the console.

## The plane
- Left bar: document types (click → at the centre; drag → where you drop it), Post-it, Frame.
- Wheel zooms around the pointer (0.03×–12×); pan with the middle or right button, or Space + drag; Shift + wheel pans sideways.
- Drag on empty space selects; Shift adds. Drag moves the selection; a frame carries what sits inside it (Alt: the frame alone).
- Hover a document: Open · Copy · Add what is copied · Replace with what is copied; × deletes. Double-click the name to rename.
- Stash (bottom left): drop documents there to keep them waiting; drag a chip out to place it, click it to open.
- Keys: Delete, Ctrl+Z (undo), Ctrl+A, Ctrl+C (copies every selected document in one), Esc.

## The editor
- `[name*]` creates a document in the stash and becomes `[name*N]`. Typing `[` suggests existing documents; picking one
  writes `[Name*N]` with the name selected so you can rewrite the label; Enter inside the label jumps out of the link.
- Ctrl+click a link (or click its `*N`) opens it. `[text]` with no `*` is plain text.
- Deleting document N removes links to it (they stay as `[label]`) and shifts every later number down by one.
- `[TAG]` at the start of a line colours the line (suggests the tags in use). `> text` is a small note (🗒️).
  `------` is a rule drawn across the page (only visual). Brackets, parentheses, `>>` and `::` are coloured.
- Markdown titles make sections: `# Title` (in capitals, most room above), `## Title`, `### Title`. Clicking the «#» of a
  title (or #/##/### in the header) splits the text into the sections of that level: a section runs to the next title
  of the same level or higher. Each one gets a grip on the left to drag it (the lines slide to their new place) and,
  on the right, copy, paste over, save as a document and fold (to 1–5 lines). Text before the first title stays put.
- «Formato» switches all of this off to see the bare text.
