# Components

All in `src/lib/ui/`. Each one takes data and callbacks as props and owns no game rules: rules
(attacks, healing, conditions) belong to D16, the scene to D11. The view models they render are
pure functions in `table-view.ts`, tested in `tests/table-view.test.ts`.

| Component | Props | Notes |
| --- | --- | --- |
| `Button` | `variant`, `icon`, `pressed`, `unavailable`, `label`, `onclick` | `unavailable` keeps the button focusable and announced (`aria-disabled`) but inert: the player can still learn why. `pressed` only for toggles. |
| `Icon` | `name`, `size` | Stroke icons on an 18 px grid (`icons.ts`). Always decorative; the control carries the label. |
| `ZoomRail` | `levels`, `current`, `onselect` | City, district, scene, with zoom in and out. The current level uses the lantern. |
| `PlaceCaption` | `kicker`, `name`, `text` | Centred over the scene at city level; announced politely. |
| `NarrativePanel` | `lines`, `choices`, `onchoose` | Speaker label coloured by tone, then the line in the display face; numbered choices with an optional check tag. |
| `InitiativeRibbon` | `combatants`, `currentId`, `selectedId`, `onselect` | Medals in initiative order: HP ring, lantern frame for the current turn, ember diamond for enemies, spoken label with side and turn. |
| `ActionBar` | `actions`, `onaction` | One row of turn actions; the primary one ends the turn. |
| `SelectedSheet` | `combatant` | Side or role, name, HP meter (`role="meter"`), stats line with condition. |
| `IntroOverlay` | `open`, `kicker`, `title`, `subtitle`, `onenter` | Letterbox bars and the staged title; `inert` once dismissed. |
| `Toast` | `message` | One-line result of an action, `role="status"`. |

## Layout over the scene

- Top-left: brand and the campaign clock line.
- Top-centre: the initiative ribbon (combat only).
- Top-right: the selected combatant.
- Right edge, vertically centred: the zoom rail.
- Bottom-left: the narrative panel (scene level).
- Bottom, after the narrative panel: the action bar (combat only).
- Bottom-centre: the place caption (city level).

Below 1100 px the rail moves up, the ribbon scrolls horizontally, the narrative panel spans the
width above the actions and the selected sheet is hidden (the medal's label still carries it).

## States

- **Before entering:** the intro owns the screen; no caption or panel competes with the title.
- **Unavailable action:** shown at 45 % opacity with `aria-disabled`, never removed, so the bar
  does not jump between turns.
- **Fallen combatant:** HP ring empty, condition "Caída" in the sheet; the miniature tips over in
  the scene (D11).
- **Empty choices:** the narrative panel shows only the story lines.
