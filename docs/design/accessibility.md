# Accessibility

## Keyboard and focus

- Every control is a real `<button>`; the focus ring is a 2 px lantern outline (`base.css`).
- Tab order follows the screen: header, zoom rail, narrative and choices, initiative, actions.
- Choices are numbered, so keyboard shortcuts can map to them later without changing labels.
- Unavailable actions stay in the tab order with `aria-disabled`; activating them does nothing.

## Screen readers

- The narrative panel and place caption are `aria-live="polite"`.
- Initiative medals speak name, side, initiative, HP and "su turno"; selection is `aria-pressed`.
- The selected sheet's HP bar is a `role="meter"` with min, max and value.
- The 3D canvas (D11) carries a text label describing the scene and its controls.

## Colour and shape

- Contrast is measured in `tokens.md`; every text pair on panels is above 4.5:1.
- Allies and enemies differ by more than colour: enemies carry a diamond mark on the medal and
  the word "enemigo"/"Hostil" in labels; miniatures have different base rims and silhouettes.
- Check results are also written ("Éxito", "Fallo"), not only coloured.

## Motion

See `motion.md`. Reduced motion removes the flight, camera easing and ambience.

## Known limits

- Text over the live 3D scene cannot have a fixed contrast ratio; it relies on framing and a text
  shadow, and every such text also exists in a panel or label.
- The design page has not been tested with a screen reader yet; that belongs with the app
  integration (D15).
- Touch: pinch-to-zoom and drag-to-rotate are D11's input layer; the zoom rail is the always
  available fallback.
