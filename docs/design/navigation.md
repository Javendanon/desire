# Navigation

Four destinations, one persistent HUD and one scenario bar. All visible labels are Spanish because
the table plays in Spanish; the view identifiers in code stay English.

| View id | Rail label | Content |
| --- | --- | --- |
| `start` | Inicio | Campaign start: session, party summary, notes, what is left to resolve. |
| `atlas` | Atlas | Clear stylized map of Waterdeep, map controls, six place markers. |
| `encounter` | Mesa | Active scenario, initiative order, combat controls, scene log. |
| `characters` | Grupo | Party cards and the button that opens the side sheet. |

`Teclas` in the rail opens the shortcut reference; it is not a destination and never holds
`aria-current`. Only `.rail__item` elements receive `aria-current="page"`; the in-content buttons
that switch views (for example `Continuar en el atlas`) are left without it. The current
destination is marked with `aria-current="page"`.

Switching views toggles the `hidden` attribute on each `.view` section, and one CSS rule
(`.view[hidden]`) makes that authoritative. The controller never relies on CSS order to hide a
view, so a jsdom-free smoke test can assert real visibility with `checkVisibility()`.

## The three acceptance tasks

| Task | Path |
| --- | --- |
| Consult lore | HUD button `Buscar lore`, `Cmd` or `Ctrl` plus `K`, or `/`. Or open a map marker. |
| Open a sheet | HUD button `Ficha de Aubrey`, a `Abrir ficha` button in Grupo, or exactly one click from the header. |
| Jump scenario | A chip in the bottom scenario bar, or `Abrir escenario` inside a lore panel. |

The scenario bar is visible on Atlas and Mesa and shows `Escenario actual: <name>` next to the
chips, so the action is discoverable without a menu. Jumping updates the map marker, the encounter
title, the encounter place line and the log in one step.

## Keyboard

| Key | Action |
| --- | --- |
| `Cmd` or `Ctrl` plus `K`, `/` | Open lore search. |
| `Escape` | Close the side panel; native `dialog` also closes on Escape. |
| `?` | Open the shortcut help. |
| `1` to `4` | Inicio, Atlas, Mesa, Grupo. |
| `ArrowDown`, `ArrowUp` | Move focus through search results. |
| `Enter` | In the query field, open the first matching result; otherwise activate the focused result, marker or control. |

Shortcuts are ignored while focus is in a text field, so typing `?` inside the search input never
opens the help dialog. The prototype exposes no keyboard pan or drag for the map beyond the
zoom, label and hex buttons.

## State that survives a view switch

The active scenario, the initiative order, the combat log, the zoom level, the label and hex
toggles, and the open side panel all live in one controller state object. Switching from Mesa to
Atlas and back does not reset the encounter, which is the behaviour a real table needs between
scenes. The prototype keeps that state in memory only; persistence belongs to another card.
