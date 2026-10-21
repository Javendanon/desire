# Tokens

Single source of truth: `src/lib/design/tokens.css`. Components only consume its custom
properties; a colour or size that is not a token does not belong in a component.

## Colour

| Token | Value | Role |
| --- | --- | --- |
| `--color-ink` | `#0b151c` | Page ground, night sky. |
| `--color-hull` | `#0f1d26` | Solid panel surface. |
| `--color-hull-glass` | `rgba(12,23,30,.94)` | Panels over the scene (barely translucent, not frosted). |
| `--color-control` | `rgba(11,21,28,.88)` | Secondary buttons over the scene. |
| `--color-fog` / `--color-fog-strong` | `#2c3e49` / `#3a4c57` | Borders. |
| `--color-rule` | `#23343e` | Dividers, empty HP track. |
| `--color-sea` | `#12303f` | Water in the 3D scene. |
| `--color-dusk` | `#2e2b33` | Dusk sky and fog colour in the scene. |
| `--color-parchment` | `#efe3c8` | Primary text. |
| `--color-mist` | `#c9cfc8` | Body text over panels, captions. |
| `--color-ash` | `#a7b2b4` | Secondary text, metadata, narrator label. |
| `--color-lantern` | `#e0aa4f` | The one accent: current turn, primary action, current level, voices. |
| `--color-verdigris` | `#7fb39b` | Ally HP, successful check. |
| `--color-ember` | `#ea7360` | Enemy HP and mark, failed check. |

### Measured contrast (WCAG 2.1 relative luminance)

| Pair | Ratio |
| --- | --- |
| parchment on ink | 14.5 |
| parchment on hull | 13.5 |
| parchment on control | 14.0 |
| mist on hull | 10.8 |
| ash on hull | 7.9 |
| lantern on hull | 8.2 |
| ink on lantern (primary button) | 8.8 |
| verdigris on hull | 7.2 |
| ember on hull | 5.8 |
| parchment / mist / lantern on dusk | 10.9 / 8.8 / 6.6 |

Text drawn directly over the moving 3D scene (place captions, initiative names) also carries
`--shadow-text`. The scene behind it changes, so its contrast cannot be guaranteed by a single
ratio; captions are placed where the camera framing keeps sky or fog behind them, and every
caption also exists in a panel or an accessible label.

## Type

| Token | Font | Use |
| --- | --- | --- |
| `--font-display` | IM Fell English (regular, italic) | Titles, place names, narration. Italic only for voices. |
| `--font-ui` | Alegreya Sans (400, 500, 700) | Body copy, choices, stats. |
| `--font-label` | Alegreya Sans SC (500, 700) | Small-caps labels, buttons, kickers. |

Sizes: `--text-label` 14, `--text-ui-sm` 15, `--text-ui` 17, `--text-body` 19, `--text-voice` 21,
`--text-name` 26, `--text-heading` 36, `--text-place` 46 px, and `--text-title` (64–148 px,
fluid). Labels are tracked (`--tracking-label` .12em, `--tracking-kicker` .3em).

## Space, shape, motion

- Space: 4, 8, 12, 16, 24, 28 and 40 px (`--space-1` … `--space-7`).
- Shape: `--radius` 3 px everywhere. Sharp, printed corners instead of app-like pills.
- Controls are at least `--control-height` 44 px tall.
- Motion: `--ease-settle` for things arriving, `--ease-sweep` for the letterbox and camera-like
  sweeps; 200 ms for hover, 500 ms for panel values, 2.4 s for the title. See `motion.md`.
