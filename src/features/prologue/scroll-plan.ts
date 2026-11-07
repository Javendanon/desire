// Scroll math for the campaign prologue. Pure functions only: the controller in
// `scroll-prologue.ts` reads the scroll offset from the DOM and writes these numbers back as
// inline styles, so the geometry can be tested without a browser.

/** Scroll offset at which each scene reaches full opacity. O(scenes). */
export function sceneCentres(count: number, viewport: number): number[] {
  if (count <= 0) return [];
  const maxScroll = Math.max(0, count - 1) * viewport;
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => (maxScroll * index) / (count - 1));
}

/** Scene opacity 0..1: full at its centre, zero one `fade` away, linear in between. */
export function sceneOpacity(scrollTop: number, centre: number, fade: number): number {
  if (fade <= 0) return scrollTop === centre ? 1 : 0;
  const opacity = 1 - Math.abs(scrollTop - centre) / fade;
  return Math.min(1, Math.max(0, opacity));
}
