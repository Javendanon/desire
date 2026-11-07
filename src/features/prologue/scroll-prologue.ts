// Scroll-driven prologue controller: stills cross-dissolve and drift as the reader scrolls.
// Adapted from scroll-world (https://github.com/oso95/scroll-world), MIT licensed. The upstream
// engine scrubs video clips with a requestAnimationFrame loop, builds its own DOM and injects
// global CSS; this adaptation keeps only the spec-required use case (one existing illustration,
// no generated clips), renders the markup in Svelte and never starts an animation loop.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software
// and associated documentation files (the "Software"), to deal in the Software without
// restriction, including without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions: the above copyright
// notice and this permission notice shall be included in all copies or substantial portions of
// the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
//
// The prologue creates no blob URLs: stills load as plain <img src>, so leaving the scene has
// nothing to revoke. A future clip path must revoke its object URLs here.
import { sceneCentres, sceneOpacity } from './scroll-plan.ts';

/** The bits of a scrolling element the controller reads and observes. */
export interface ScrollSurface {
  scrollTop: number;
  clientHeight: number;
  addEventListener(type: 'scroll', listener: () => void, options: { passive: true }): void;
  removeEventListener(type: 'scroll', listener: () => void): void;
}

/** One full-screen scene: opacity on the root, drift on the still. */
export interface PrologueScene {
  root: { style: { opacity: string } };
  still: { style: { transform: string } } | null;
}

export interface PrologueOptions {
  reducedMotion?: boolean;
}

export interface PrologueHandle {
  destroy(): void;
}

// A still sits close to the viewport edge so the drift stays inside the image, never past it.
const STILL_SCALE = 1.06;
const STILL_DRIFT = 0.08;
const SCALE_DECIMALS = 3;

/** Mounts the scene painter. `destroy()` detaches the only listener it adds. */
export function mountScrollPrologue(
  surface: ScrollSurface,
  scenes: readonly PrologueScene[],
  options: PrologueOptions = {},
): PrologueHandle {
  if (options.reducedMotion || scenes.length === 0) return { destroy() {} };

  const paint = (): void => {
    const fade = Math.max(1, surface.clientHeight);
    const centres = sceneCentres(scenes.length, fade);
    scenes.forEach((scene, index) => {
      const centre = centres[index];
      const drift = Math.min(1, Math.abs(surface.scrollTop - centre) / fade);
      scene.root.style.opacity = String(sceneOpacity(surface.scrollTop, centre, fade));
      if (scene.still) scene.still.style.transform = `scale(${scaleOf(drift)})`;
    });
  };

  const onScroll = (): void => paint();
  surface.addEventListener('scroll', onScroll, { passive: true });
  paint();

  // ponytail: the geometry is recomputed per scroll event, so a viewport resize with no scroll
  // keeps the previous drift until the next scroll. Add a resize listener when that shows up.
  return {
    destroy(): void {
      surface.removeEventListener('scroll', onScroll);
    },
  };
}

function scaleOf(drift: number): string {
  return (STILL_SCALE + drift * STILL_DRIFT).toFixed(SCALE_DECIMALS);
}
