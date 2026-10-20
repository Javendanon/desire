// A typed event emitter: `on` returns the function that removes the listener.

type Listener<T> = (value: T) => void;

export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    this.listeners.get(event)?.forEach((listener) => (listener as Listener<Events[K]>)(value));
  }

  clear(): void {
    this.listeners.clear();
  }
}
