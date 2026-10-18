# Accessibility

## Keyboard and focus

- A `Saltar al contenido` skip link is the first focusable element and moves to `#main`.
- Landmarks: `<header>` HUD, `<nav>` rail, `<main>`, `<nav>` scenario bar, `<aside>` side panel.
- The search and help overlays are native `<dialog>` elements shown with `showModal()`, so the
  browser provides focus containment, Escape to close and focus restoration.
- The side panel is deliberately **non modal** (`aria-modal="false"`): opening a sheet or a lore
  entry keeps the map in the tab order. `openPanel` remembers the trigger and returns focus to it
  on close; the panel title is the accessible name.
- Every control uses a real `<button>`, including map markers and initiative rows, so Enter and
  Space work without custom key handling.
- Search results are buttons in a list. `ArrowDown` and `ArrowUp` are handled on the results
  container as well as the input, so focus moves from the input into the list and keeps moving
  between results.
- `aria-current` marks the active rail item, marker and scenario chip. Toggles expose
  `aria-pressed`. The toast uses `role="status"` to announce the last combat action; the scene
  log is visual only, so it is not re-read on every render.

## Contrast

The shipped token pairs measure between 7.62 and 15.23 under the WCAG 2.1 formula, all above the
4.5 floor and most above 7. `tokens.test.js` recomputes each documented pair from `styles.css` and
fails if a ratio drops below 4.5. The full table lives in `tokens.md`.

Colour is never the only signal: the active turn also carries a border and a heavier surface, a
fallen participant carries reduced opacity plus the `Caída` condition text (set by
`conditionAfter`), and low health changes both the bar colour and the numeric HP text.

## Reduced motion

`prefers-reduced-motion: reduce` removes every animation and transition through one global rule.
The side panel stops sliding and appears instantly; the map zoom applies without an animated
transition. No control depends on motion to become usable, and no scroll driven effect is used,
so nothing is lost when the preference is active.

## Zoom and text

Text uses relative units and the shell is a grid, so browser zoom does not clip panels. On a 390px
viewport the rail becomes a bottom tab bar, the HUD hides the weather stat, the side panel spans
94vw and the map keeps a 320px minimum height. That mobile behaviour is asserted in `smoke.mjs`
through the computed flex direction of the rail.

## Known limits

- No automated axe or screen reader pass was run. The checks above are source review plus the
  headless DOM smoke test; a manual audit belongs with the cards that integrate the real screens.
- The map is one `role="img"` with an `aria-label` plus accessible marker buttons. It is a
  prototype map, not a navigable coordinate grid; keyboard panning is out of scope.
- The search results list is an accessible button list, not a full ARIA listbox with roving
  tabindex. It satisfies the keyboard flow without the extra machinery; revisit if the result set
  grows beyond about twenty entries.
- Focus order follows DOM order, which matches the visual order in the shell. The side panel is
  appended after the scenario bar, so a keyboard user reaches it after the main region.
- The number keys that switch views are ignored while focus is in a text field. The smoke test
  asserts this by firing `2` inside the search input and checking that the view does not change.
- The CSS is split into four files so no stylesheet exceeds the F6 400 line ceiling. The contrast
  test reads `tokens.css` and requires each colour token to be declared exactly once.
