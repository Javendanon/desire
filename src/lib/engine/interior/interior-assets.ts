// Loads the glTF containers of an interior (one per floor, the slide, one per furniture kind) and
// hands out fresh entity copies. `destroy()` unloads every asset it loaded.
import * as pc from 'playcanvas';

export class InteriorAssets {
  private readonly app: pc.AppBase;
  private readonly assets = new Map<string, pc.Asset>();
  private destroyed = false;

  constructor(app: pc.AppBase) {
    this.app = app;
  }

  /** Loads every `name → url` pair in parallel. A missing file rejects with its name. */
  async load(urls: ReadonlyMap<string, string>): Promise<void> {
    await Promise.all([...urls].map(([name, url]) => this.loadOne(name, url)));
  }

  private loadOne(name: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (error || !asset) {
          reject(new Error(`interior: could not load ${name} from ${url}: ${error ?? 'no asset'}`));
          return;
        }
        if (this.destroyed) {
          this.release(asset); // finished after destroy: never kept
        } else {
          this.assets.set(name, asset);
        }
        resolve();
      });
    });
  }

  has(name: string): boolean {
    return this.assets.has(name);
  }

  /** A new entity tree for the loaded model `name`. */
  instantiate(name: string): pc.Entity {
    const asset = this.assets.get(name);
    if (!asset) throw new Error(`interior: model ${name} was not loaded`);
    return (asset.resource as pc.ContainerResource).instantiateRenderEntity();
  }

  private release(asset: pc.Asset): void {
    asset.unload();
    this.app.assets.remove(asset);
  }

  /** Unloads every asset, including ones that finish loading afterwards. */
  destroy(): void {
    this.destroyed = true;
    for (const asset of this.assets.values()) this.release(asset);
    this.assets.clear();
  }
}
