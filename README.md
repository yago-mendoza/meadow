# Meadow

Principles of the app and of how to work on it: `PRINCIPLES.md` (read first).

A zoomable grid (pastel, dotted) of documents, post-its, ideas, tasks, frames and signs, with a Notepad-like editor.

- **Start:** double-click `Meadow.vbs` (or the Meadow shortcut on the desktop): it starts `node server.mjs` without a window and
  opens http://localhost:5240. Data: `data/meadow.json` (one backup a day in `data/backups/`). `MEADOW_PORT` / `MEADOW_DATA` override both.
- **Build the editor** after changing `src/editor.js`: `npm run build` → `public/editor.bundle.js`.
  `@codemirror/view` is pinned to 6.43.15: 6.44.1 logs every DOM event to the console.

## The plane
- Toolbar (top): Documento, Post-it, Idea, Tarea, Marco, Etiqueta. Click: at the centre (a document opens); drag: where you drop it.
- **Click** a thing: the view centres and zooms on it, and «Volver a donde estabas» takes you back. **Double click** a document opens it.
  Click a document's or a frame's title to rename it.
- Drag the empty grid to move around (also middle/right button or Space + drag); the wheel zooms around the pointer.
- Ctrl + drag on empty grid selects a group (Shift adds); Shift/Ctrl + click adds or removes one. With two or more selected, a bar copies them all.
- **What moves with what** (Alt: only the selection): a frame carries what is inside it, frames inside it too (nested);
  a document carries the post-its, ideas and tasks lying on it; small things carry the small things they touch, except
  what lies on a document that is not moving. The corner handle scales a thing as a whole, with what it carries.
- Hover something partly covered: it comes forward (with what lies on it) while the pointer is over it. «Al frente» / «Al fondo» keep it there.
- **Ideas and tasks**: loose, they are small circles (a click reads them, a double click writes on their own colour); dropped on a
  document or post-it they pin to its nearer side edge, on a frame next to its tab. Dropped just under a document they dock: as
  wide as the page, three lines at most. Beyond five docked, the larger kind folds into a numbered circle (blue tasks, gold ideas)
  that lists them beside it.
- **Frames**: dropped near loose things they wrap them; dragging something into a frame makes it (and the frames holding it) grow to fit, live, and back if you pull it out; «＋» on the tab makes a frame inside; square corners.
- **Ribbons** («ribetes»): a strip of cloth standing out of the nearest edge, red unless you pick another colour in its reader; drag it to move it.
- **Drawers** («cajones», bottom left): one shape that changes size, like the InfraPhysics site assistant (opening: width then
  height; closing: height down, then width). Tucked, a little chest: the drawer under the pointer slides out, a click opens that
  drawer, a click anywhere else puts them away. They also come out when a dragged document reaches their corner. Up to six,
  each with its colour (click its dot), rename (click its name), «⤢» puts all its documents on the plane.
- **Panel** (right): tasks (pending / done / all) and ideas, grouped by the frame they are in; history with «Restaurar»,
  «Volver a como estaba» for documents, and «Ir» / «Abrir» for pieces that still exist.
- Zoomed out too far to read, the thing under the pointer shows its title in a viewer at the bottom.
- A document's name is its first `# Title` in the text: renaming it (plane, header, drawer) rewrites that title, and editing the title renames it.
- Ctrl+V on the plane: a copied idea or task appears there; any other text becomes a post-it.

## The editor
- Index on the left (click to go). Jumping through links leaves a trail over the text: «← Volver», each step peeked on hover (that document where you were) and reached on click. `# Title` (capitals), `## Title`, `### Title` make sections; a chevron left of each title folds
  it (to the title), and the one above them folds or unfolds all. Clicking a title's «#» (or #/##/### in the header) splits the
  text into the sections of that level: each one gets a band, a grip to drag it and buttons to copy, paste over, save as a document and fold.
- `[` suggests documents, ideas and tasks, or creates a new one; `[name*]` creates a document. A link shows its label and a ↗ that opens it.
  Ideas and tasks inside the text are the same objects as on the plane: tick or rename them anywhere.
- `[TAG]` at the start of a line colours it; `> text` is a small note; `------` is a rule; brackets, parentheses, `>>` and `::` are coloured.
- ¶ switches all of this off to see the bare text.
