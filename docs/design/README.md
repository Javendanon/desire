# Desire · visual experience design (card D03)

Isolated UI/UX proposal for the Desire campaign table, first city Waterdeep. This directory owns
the design tokens, the component and navigation contracts, the state catalogue, the accessibility
notes and an isolated prototype. It does **not** replace `src/App.svelte` and does not change any
API, domain or data contract.

## Deliverables

| File | Contents |
| --- | --- |
| `tokens.md` | Colour, type, spacing and radius tokens with measured contrast. |
| `components.md` | Component inventory, states (empty, loading, error) and the HUD plus map rules. |
| `navigation.md` | View map, Spanish labels, scenario jump and keyboard shortcuts. |
| `accessibility.md` | Keyboard, focus, contrast, reduced motion and known limits. |
| `art-provenance.md` | Origin of every visual asset and text used by the prototype. |
| `advisor-response.md` | Independent review findings and how each one was resolved. |
| `rework-verification.md` | Six review fixes, RED/GREEN evidence, metrics and coverage limits. |
| `prototype/` | Runnable mockup, desktop and mobile, in plain HTML, CSS and ES modules. |

## Run the prototype

The prototype has no build step and no runtime dependency. Serve it from the repository root so the
relative brand asset resolves:

```sh
python3 -m http.server 4174        # from the repository root
# http://127.0.0.1:4174/docs/design/prototype/index.html
```

With the installed Vite toolchain the same page is available without touching the app entry:

```sh
pnpm vite --port 5199 --strictPort --host 127.0.0.1
# http://127.0.0.1:5199/docs/design/prototype/index.html
```

Port 5173 belongs to another worktree in this session; the prototype uses its own port on purpose.

## Verification

```sh
node --test docs/design/prototype/*.test.js   # 17 checks: table state, markup, token contrast
node docs/design/prototype/smoke.mjs          # headless Chrome end to end, needs the page served
```

`smoke.mjs` checks visibility and hit targets before sending real pointer input; it rejects
hidden combat controls and navigates to the encounter before operating them. Review regressions
in `rework-smoke.mjs` cover live HP in all summaries and open sheets, keyboard focus after row
selection, event-lore scenario jumps, rendered fallen-text contrast, search cancellation in every
request state on desktop and mobile touch, and reduced motion.

It also checks six map markers, five initiative rows, the immediate
next turn and damage responses, the lore search result plus the empty and error states, arrow-key
movement inside the results, that digits do not switch views while typing, real view visibility via
`checkVisibility()`, the side panel, the scenario jump, and the mobile rail and map height. It uses
the Chrome already installed on the machine and the DevTools protocol, so it adds no dependency.
CSS is split into `tokens.css`, `layout.css`, `components.css` and `overlays.css`; no file crosses
the 400 line ceiling.

## Scope boundaries

- Marketing sections from the vendored `landing-page-design` skill are intentionally dropped:
  headline plus CTA funnels, tagline reveal, FAQ and risk reversal do not belong at a game table.
- The visual rules that survive are the type scale, spacing table, radius formula, flat
  backgrounds, state coverage, focus rings and physical easing. See `components.md`.
- This card does not wire the prototype into the application shell, routing, persistence or the
  Rust API. Integration belongs to the cards that own those contracts.
