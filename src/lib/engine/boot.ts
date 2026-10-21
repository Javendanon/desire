// Graphics device and PlayCanvas app: WebGPU when the browser has it, WebGL 2 otherwise. Only
// the component systems the viewer uses are registered, so the bundle stays engine-only.

import * as pc from 'playcanvas';

export interface BootOptions {
  /** 'auto' tries WebGPU first and falls back to WebGL 2. */
  backend: 'auto' | 'webgl2';
  /** Caps the pixel ratio at 1 instead of 2. */
  lowQuality: boolean;
}

export class ViewerError extends Error {
  override name = 'ViewerError';
}

async function createDevice(
  canvas: HTMLCanvasElement,
  backend: BootOptions['backend'],
): Promise<pc.GraphicsDevice> {
  const deviceTypes =
    backend === 'webgl2' ? [pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2];
  try {
    return await pc.createGraphicsDevice(canvas, {
      deviceTypes,
      antialias: false,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ViewerError(
      `Este navegador no pudo iniciar la vista 3D (ni WebGPU ni WebGL 2): ${reason}`,
    );
  }
}

export async function bootApp(
  canvas: HTMLCanvasElement,
  options: BootOptions,
): Promise<pc.AppBase> {
  const device = await createDevice(canvas, options.backend);
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, options.lowQuality ? 1 : 2);
  const app = new pc.AppBase(canvas);
  const appOptions = new pc.AppOptions();
  appOptions.graphicsDevice = device;
  appOptions.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.LightComponentSystem,
  ];
  app.init(appOptions);
  app.setCanvasFillMode(pc.FILLMODE_NONE);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  return app;
}
