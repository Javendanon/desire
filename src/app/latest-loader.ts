// Runs one load at a time and publishes only the newest: a slow answer for a campaign the user
// already left is dropped, so its data can never appear under the campaign now open.

export type LoadState<K, T> =
  | { status: 'idle' }
  | {
      status: 'loading';
      key: K;
    }
  | {
      status: 'ready';
      key: K;
      value: T;
    }
  | {
      status: 'failed';
      key: K;
      error: unknown;
    };

export type Loader<K, T> = (key: K, signal: AbortSignal) => Promise<T>;

export class LatestLoader<K, T> {
  private readonly load: Loader<K, T>;
  private readonly publish: (state: LoadState<K, T>) => void;
  private controller: AbortController | null = null;
  private key: K | null = null;

  constructor(load: Loader<K, T>, publish: (state: LoadState<K, T>) => void) {
    this.load = load;
    this.publish = publish;
  }

  open(key: K): void {
    this.publish({ status: 'loading', key });
    this.start(key, (error) => this.publish({ status: 'failed', key, error }));
  }

  reload(): void {
    if (this.key !== null) this.open(this.key);
  }

  /**
   * Reloads behind the current state, so the screen and its focus stay in place. A failure goes
   * to the caller because the data on screen is still the last good answer.
   */
  refresh(onfailure: (error: unknown) => void): void {
    if (this.key !== null) this.start(this.key, onfailure);
  }

  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.key = null;
  }

  private start(key: K, onfailure: (error: unknown) => void): void {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.key = key;
    this.load(key, controller.signal).then(
      (value) => {
        if (controller === this.controller) this.publish({ status: 'ready', key, value });
      },
      (error: unknown) => {
        if (controller === this.controller) onfailure(error);
      },
    );
  }
}
