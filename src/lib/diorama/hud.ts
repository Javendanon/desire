// Performance HUD (`?hud`): real frame intervals from requestAnimationFrame on the viewer's own
// display, so a judder can be measured where it is felt. Shows the display's refresh rate (the
// median frame of a scene that keeps up, since the shortest frames jitter short), fps, median
// and p95 frame times, the share of dropped frames, draw calls and the quality preset. To tell
// a slow CPU from a slow GPU it also shows the backend, the drawing buffer's size, the engine's
// CPU update and render times and the GPU frame time (when the device can time it).

import type * as pc from 'playcanvas';

import { watchLongFrames } from './long-frames.ts';
import { createMeter, meterSummary, recordFrame, type Meter } from './perf-meter.ts';

const WINDOW_FRAMES = 240;
const REFRESH_MS = 500;
/**
 * A frame counts as dropped when it lasts over 1.5 refresh intervals: the display repeated an
 * image. Plain vsync jitter (16.8 ms at 60 Hz) does not count.
 */
const DROPPED_INTERVALS = 1.5;

const percent = (share: number) => `${(share * 100).toFixed(0)} %`.padStart(5);
const ms = (value: number | undefined) => (value === undefined ? 'n/a' : value.toFixed(1));

/** Where the frame's time goes, as the engine measures it. */
function deviceLines(app: pc.AppBase): string[] {
  const device = app.graphicsDevice;
  const { stats } = app;
  return [
    `backend   ${device.deviceType} · ${device.width}×${device.height}`,
    `cpu       update ${ms(stats.cpuUpdateTime)}  render ${ms(stats.cpuRenderTime)} ms`,
    `gpu       ${ms(stats.gpuFrameTime)} ms`,
  ];
}

/** The display's refresh and how the frames kept up with it. */
function frameLines(meter: Meter, quality: string): string[] {
  const interval = meterSummary(meter, Infinity).p50;
  const frames = meterSummary(meter, interval * DROPPED_INTERVALS);
  const hertz = interval > 0 ? 1000 / interval : 0;
  return [
    `quality   ${quality}`,
    `display   ${hertz.toFixed(0)} Hz`,
    `fps       ${frames.fps.toFixed(0)}`,
    `frame     p50 ${frames.p50.toFixed(1)}  p95 ${frames.p95.toFixed(1)} ms`,
    `dropped   ${percent(frames.overBudget)}`,
  ];
}

/** Records every animation frame's interval into the meter until stopped. */
function recordFrames(meter: Meter): () => void {
  let last = 0;
  let frame = 0;
  const step = (now: number) => {
    if (last > 0) recordFrame(meter, now - last);
    last = now;
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

export function mountHud(element: HTMLElement, app: pc.AppBase, quality: string): () => void {
  const meter = createMeter(WINDOW_FRAMES);
  const long = watchLongFrames();
  const render = () => {
    element.textContent = [...frameLines(meter, quality), `draws     ${app.stats.drawCalls.total}`,
      ...deviceLines(app), ...long.lines()].join('\n');
  };
  if (app.graphicsDevice.gpuProfiler) app.graphicsDevice.gpuProfiler.enabled = true;
  element.hidden = false;
  const stopRecording = recordFrames(meter);
  const timer = setInterval(render, REFRESH_MS);
  return () => {
    stopRecording();
    clearInterval(timer);
    long.stop();
    element.hidden = true;
  };
}
