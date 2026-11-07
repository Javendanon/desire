// Once-only teardown for a viewer: it joins a live set when created, and `end()` takes it out and
// runs its cleanups exactly once, so a smoke test can count leaked viewers.

export class Lifecycle<T> {
  readonly cleanups: (() => void)[] = [];
  private readonly live: Set<T>;
  private readonly owner: T;
  private done = false;

  constructor(live: Set<T>, owner: T) {
    this.live = live;
    this.owner = owner;
    live.add(owner);
  }

  get ended(): boolean {
    return this.done;
  }

  /** Leaves the live set and runs the cleanups. False when it had already ended. */
  end(): boolean {
    if (this.done) return false;
    this.done = true;
    this.live.delete(this.owner);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    return true;
  }
}
