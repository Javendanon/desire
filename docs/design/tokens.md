# Tokens

Single source of truth: `prototype/tokens.css` for colour, type, spacing and radius. `layout.css`,
`components.css` and `overlays.css` only consume those custom properties. `tokens.test.js` reads
`tokens.css`, requires each colour token exactly once, and recomputes the pair ratios below.

## Colour

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#131209` | Application background, the darkest surface. |
| `--color-panel` | `#1f1f1f` | HUD, rail, panels, dialogs. |
| `--color-raised` | `#272727` | Inputs, active rows, hover surfaces. |
| `--color-line` | `#313131` | Full borders and dividers. |
| `--color-text` | `#e7eacb` | Primary text and the brand mark ink. |
| `--color-muted` | `#a9b3a9` | Secondary text, metadata, hints. |
| `--color-accent` | `#d4df9b` | Primary action, focus ring, current marker. |
| `--color-accent-deep` | `#294c3b` | Selected navigation and tags. |
| `--color-danger` | `#f2b0a8` | Low health, error text and borders. |
| `--color-warn` | `#e8c98a` | Reserved for warnings; not used by this prototype. |

Backgrounds stay inside the vendored skill palette (`#131209`, `#181818`, `#1f1f1f`, `#272727`,
`#313131`). The map reuses the same palette: sea `#181818`, land `#272727`, wards and walls as
transparent accent strokes so the map never introduces a new hue.

### Measured contrast

Ratios use the WCAG 2.1 relative luminance formula. `tokens.test.js` recomputes them from
`styles.css` and fails below 4.5, so a future token edit cannot silently break the floor.

| Pair | Ratio | WCAG |
| --- | --- | --- |
| text on bg | 15.23 | AAA |
| muted on bg | 8.68 | AAA |
| text on panel | 13.37 | AAA |
| muted on panel | 7.62 | AAA |
| accent on panel | 11.64 | AAA |
| bg on accent | 13.26 | AAA |
| text on accent-deep | 7.77 | AAA |
| danger on panel | 9.07 | AAA |
| warn on panel | 10.32 | AAA |

## Type

One typeface. No italics, no weight above 600. The stack prefers Geist then Manrope when they are
installed, and falls back to Avenir Next and the system UI so the prototype ships no font file and
makes no network request.

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 12px | Eyebrows, tags, metadata, keyboard hints. |
| `--text-sm` | 14px | Buttons, list rows, HUD stats, log lines. |
| `--text-base` | 16px | Body copy and inputs. |
| `--text-lg` | 18px | Lede paragraph, stat values. |
| `--text-xl` | 20px | Panel and section headings. |
| `--text-2xl` | 24px | Page heading on mobile. |
| `--text-3xl` | 30px | Page heading on desktop. |

Sizes snap to the Tailwind scale steps; tracking and line height stay inside the matched step.
CSS lives in four files (tokens 129, layout 174, components 327, overlays 299 lines) so no file
crosses the F6 400 line ceiling.

## Spacing

Only the vendored table is used, as custom properties: `--space-25` 2px, `--space-50` 4px,
`--space-75` 8px, `--space-100` 12px, `--space-200` 16px, `--space-300` 24px, `--space-400` 32px,
`--space-500` 40px, `--space-600` 48px. Buttons use 8px vertical and 12px horizontal padding.

## Radius

`--radius-sm` 4px, `--radius-md` 8px, `--radius-lg` 12px, `--radius-xl` 16px, `--radius-full`
9999px. Nested shapes follow `inner = outer - gap`; the marker button inside the map frame uses
the full radius because the result stays above 2px.

## Motion

`--ease-fluid: cubic-bezier(0.32, 0.72, 0, 1)`. Hover and selection transitions run between 200ms
and 400ms. No element appears statically after a view switch that would delay input; the only
entrance animation is the side panel, and `prefers-reduced-motion` removes it.
