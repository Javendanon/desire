// Long frames for the performance HUD, from Chrome's Long Animation Frames API: how many frames
// ran past 50 ms since the last look, the worst one, and the script that held it longest. A long
// frame with almost no script time points outside JavaScript: garbage collection, the GPU
// process or the browser itself.

const ENTRY_TYPE = 'long-animation-frame';

/** The fields of a long animation frame script entry the HUD reads. */
interface FrameScript {
  duration: number;
  invoker?: string;
  sourceFunctionName?: string;
  sourceURL?: string;
}

interface LongFrame extends PerformanceEntry {
  scripts?: FrameScript[];
}

export interface LongFrames {
  /** Two HUD lines about the frames seen since the previous call. */
  lines(): string[];
  stop(): void;
}

const fileOf = (url = '') => url.split('/').pop()?.split('?')[0] || '?';

const scriptTime = (frame: LongFrame) =>
  (frame.scripts ?? []).reduce((sum, script) => sum + script.duration, 0);

function culprit(frame: LongFrame | null): string {
  const scripts = [...(frame?.scripts ?? [])].sort((a, b) => b.duration - a.duration);
  const top = scripts[0];
  if (!top) return 'culprit   no script: GC, GPU or browser';
  const name = top.sourceFunctionName || top.invoker || 'anonymous';
  return `culprit   ${name} · ${fileOf(top.sourceURL)} ${top.duration.toFixed(0)} ms`;
}

function summary(frames: LongFrame[]): string[] {
  if (frames.length === 0) return ['long      none', 'culprit   -'];
  const worst = frames.reduce((a, b) => (b.duration > a.duration ? b : a));
  const script = scriptTime(worst).toFixed(0);
  return [`long      ${frames.length} · worst ${worst.duration.toFixed(0)} ms (script ${script})`,
    culprit(worst)];
}

export function watchLongFrames(): LongFrames {
  if (!PerformanceObserver.supportedEntryTypes.includes(ENTRY_TYPE)) {
    return { lines: () => ['long      n/a in this browser'], stop: () => {} };
  }
  let seen: LongFrame[] = [];
  const observer = new PerformanceObserver((list) => {
    seen.push(...(list.getEntries() as LongFrame[]));
  });
  observer.observe({ type: ENTRY_TYPE });
  return {
    lines: () => {
      const lines = summary(seen);
      seen = [];
      return lines;
    },
    stop: () => observer.disconnect(),
  };
}
