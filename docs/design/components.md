# Components and states

Every interactive component ships hover, active and focus. Focus is a 2px accent ring with a 2px
offset, visible on every focusable element. The prototype keeps one visual language: flat panels,
a full 1px border, and a radius that follows the nested formula.

## Inventory

| Component | Selector | Notes |
| --- | --- | --- |
| HUD bar | `.hud` | Campaign, clock, weather and the three global actions. |
| Destination rail | `.rail` | Inicio, Atlas, Mesa, Grupo, Teclas with `aria-current`. |
| Scenario bar | `.scenario-bar` | Current scenario label plus one chip per scenario. |
| Map frame | `.map-frame` | Original SVG, marker layer, no scroll trap. |
| Marker | `.marker` | Numbered button per place, `aria-current` for the active scenario. |
| Side panel | `.side-panel` | Non modal `role="dialog"` for a lore entry or a character sheet. |
| Search dialog | `.search` | Native `dialog`, command palette behaviour. |
| Help dialog | `.help` | Shortcut reference. |
| Turn row | `.turn` | Initiative number, name, HP bar, condition, active state. |
| HP bar | `.hp-bar` | Accent above 30 percent, danger at or below. |
| Party card | `.party-card` | Sheet summary and the button that opens the side panel. |
| Log list | `.log-list` | Newest first, `aria-live="polite"` on the container. |
| Button | `.button` | Primary, quiet, icon and toggle variants. |
| Tag, stat grid, toast, skeleton, state note | `components.css`, `overlays.css` | Small shared pieces. |

## States

| State | Where | Rendering |
| --- | --- | --- |
| Empty | Lore search | Composed note with three working suggestions (`puerto`, `guardia`, `pozo`) instead of a blank list. |
| Loading | Lore search | Three skeletons shaped like result rows plus the status text `Buscando en el lore…`. The map and the HUD stay interactive. |
| Error | Lore search | Inline note, danger border and a `Reintentar` button. No alert dialog. |
| Active | Turn row, marker, rail item, scenario chip | Accent background or border and `aria-current` or `data-active`. |
| Fallen | Turn row | Reduced opacity at 0 HP plus the `Caída` condition text, still reachable by keyboard. `conditionAfter` sets it when HP reaches 0 and clears it when the participant is healed. |
| Hover and active | Every button | Surface shift on hover, `scale(0.98)` on press. |
| Focus | Every control | Visible accent ring. |

The search demo controls in the dialog (`Listo`, `Cargando`, `Error`) exist so a reviewer can see
all three states without a network. `setRequestState` cancels any pending debounce, so choosing a
demo state is not overwritten a moment later. They are part of the prototype, not of a future app
screen.

Combat feedback is announced through the toast, which is `role="status"`; the scene log stays a
visual list without `aria-live` so a full re-render does not re-announce every earlier line.

## HUD and map coexistence

The layout is a three row grid: the HUD spans the top, the rail holds the left column, and the
scenario bar closes the bottom. The map fills the remaining box, so no floating HUD card covers
the city centre. Concretely:

- The map frame keeps its own 1px border and radius; markers sit inside it and never under the
  HUD, because the frame starts below the bar.
- The side panel overlays only the right edge and is non modal: the map stays visible and
  keyboard reachable while a lore entry is open. Escape and the close button both dismiss it.
- On mobile the shell reorders to HUD, main, scenario bar, rail. The rail becomes a bottom tab
  bar and the map keeps a 320px minimum height so a scene remains readable.
- Zoom, district labels and the hex overlay are map locals; changing them never re-renders the
  HUD, the encounter or the log.

## Adaptation of the vendored visual skill

Kept: the type scale, the spacing table, the radius formula, flat backgrounds, the no italics and
no ultra bold rules, full state coverage, visible focus, `IntersectionObserver` style concerns
avoided, and the physical easing curve.

Dropped on purpose, because this is a table and not a landing page: hero with a single CTA,
benefit list, how it works, FAQ, risk reversal, tagline reveal, SEO metadata and marketing copy.
No icon set is bundled either; navigation uses Spanish words instead of glyphs, so nothing depends
on a font or an icon package that is not in the repository.
