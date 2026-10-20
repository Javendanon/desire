# Desire · visual direction "Farol en la niebla"

Card D03. The table should feel like a game without being one: the city as a 3D diorama you
zoom into (For the King), lit and textured like Baldur's Gate 3, narrated like Disco Elysium.
The owner chose this direction after reviewing the earlier prototype; it replaces it entirely.

## Principles

1. **The world first.** The interface floats over the 3D scene and never replaces it. Panels are
   small, anchored to edges, and leave the scene readable.
2. **Three distances.** City, district and scene are camera positions, reached with the same
   zoom gesture (wheel, pinch or the zoom rail). Moving between them is a camera move, never a
   page change.
3. **A narrated voice.** Story text reads like a novel: who speaks, the skill check and its
   result, numbered choices. Never a wiki infobox.
4. **One lantern.** One warm accent (Farol) marks the turn, the primary action and the current
   level. Everything else is fog and ink.
5. **Tabletop miniatures.** Characters are painted miniatures on bevelled bases, on a hex board.
   They are lifted and set down when they move, and tip over when they fall.

## Deliverables

| Path | Contents |
| --- | --- |
| `src/lib/design/tokens.css` | Colour, type, space, shape and motion tokens. |
| `src/lib/design/fonts.css`, `public/fonts/` | Self-hosted fonts with their OFL licences. |
| `src/lib/design/base.css` | Page basics: background, focus ring, reduced motion. |
| `src/lib/ui/` | Svelte components and their pure view models (`table-view.ts`). |
| `src/design/`, `design.html` | Isolated design page that composes the components. |
| `docs/design/*.md` | This document, tokens, components, motion, accessibility, provenance. |

The 3D scene itself (engine, camera, miniatures, the cinematic intro) belongs to D11. The design
page shows a flat placeholder where the scene goes.

## Run it

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm vite --port 5199 --strictPort --host 127.0.0.1
# http://127.0.0.1:5199/design.html
```

`design.html` is a second Vite entry used only in development; `vite build` still builds the app
from `index.html`, and `src/App.svelte` is unchanged.

## What this direction never does

- Lime on black, Geist and rounded cards by default: the generic AI-dashboard look.
- Wiki pages: dense text blocks, infobox tables, breadcrumbs.
- Medieval clichés: Cinzel, blackletter, burnt-parchment textures.
- Decorative gradients, frosted glass, emoji.
- A view that hides the world: panels always leave the scene visible.
- Telling allies from enemies by colour alone.

## Exploration

The direction was explored as an interactive mockup in a design canvas before this card: a
three.js diorama with the same tokens, intro flight, zoom levels and miniatures. The engine in
the app is PlayCanvas (owner's decision); D11 ports the scene to it.
