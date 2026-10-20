// Canvas resize and tab visibility for any PlayCanvas host. Returns the cleanup.

import type * as pc from 'playcanvas';

export function watchPage(app: pc.AppBase, canvas: HTMLCanvasElement): () => void {
  const resize = () => app.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const visibility = () => {
    app.timeScale = document.hidden ? 0 : 1;
  };
  document.addEventListener('visibilitychange', visibility);
  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
  };
}
