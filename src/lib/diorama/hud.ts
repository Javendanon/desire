// Performance HUD (`?hud`): real frame intervals from requestAnimationFrame on the viewer's own
// display, so a judder can be measured where it is felt. Shows the display's refresh rate
// (detected from the shortest frames), fps, median and p95 frame times, the share of dropped
// frames, draw calls and the quality preset.

import type * as pc from 'playcanvas';

import { createMeter, meterSummary, recordFrame } from './perf-meter.ts';

const WINDOW_FRAMES = 240;
const REFRESH_MS = 500;
/**
 * A frame counts as dropped when it lasts over 1.5 refresh intervals: the display repeated an
 * image. Plain vsync jitter (16.8 ms at 60 Hz) does not count.
 */
const DROPPED_INTERVALS = 1.5;

const percent = (share: number) => `${(share * 100).toFixed(0)} %`.padStart(5);

export function mountHud(element: HTMLElement, app: pc.AppBase, quality: string): () => void {
  const meter = createMeter(WINDOW_FRAMES);
  let last = 0;
  let frame = 0;
  const step = (now: number) => {
    if (last > 0) recordFrame(meter, now - last);
    last = now;
    frame = requestAnimationFrame(step);
  };
  const render = () => {
    const interval = meterSummary(meter, Infinity).p05;
    const frames = meterSummary(meter, interval * DROPPED_INTERVALS);
    const hertz = interval > 0 ? 1000 / interval : 0;
    element.textContent = [
      `quality   ${quality}`,
      `display   ${hertz.toFixed(0)} Hz`,
      `fps       ${frames.fps.toFixed(0)}`,
      `frame     p50 ${frames.p50.toFixed(1)}  p95 ${frames.p95.toFixed(1)} ms`,
      `dropped   ${percent(frames.overBudget)}`,
      `draws     ${app.stats.drawCalls.total}`,
    ].join('\n');
  };
  element.hidden = false;
  frame = requestAnimationFrame(step);
  const timer = setInterval(render, REFRESH_MS);
  return () => {
    cancelAnimationFrame(frame);
    clearInterval(timer);
    element.hidden = true;
  };
}
