// What the streamer has asked the Worker for, kept apart from what it still wants. Every request
// gets a generation, so a reply for a sector dropped and asked for again cannot be mistaken for
// the newer request. A Worker slot stays taken until its reply arrives, even when its sector was
// dropped meanwhile, so the in-flight cap holds while panning fast. A failed sector waits out a
// back-off before it is asked for again. Pure.

/** Seconds a failed sector waits before it may be requested again. */
const RETRY_AFTER_S = 30;

export interface Ledger {
  next: number;
  /** Sector → the generation of its live request, until its arrival is placed. */
  wanted: Map<number, number>;
  /** Generations the Worker is still working on. */
  inFlight: Set<number>;
  /** Sector → when it may be requested again, in seconds. */
  failed: Map<number, number>;
}

export interface Reply {
  index: number;
  generation: number;
  ok: boolean;
  /** Seconds, on the same clock as `busy`. */
  now: number;
}

export type Verdict = 'build' | 'discard';

export function createLedger(): Ledger {
  return { next: 0, wanted: new Map(), inFlight: new Set(), failed: new Map() };
}

/** Records a new request for a sector and returns its generation. */
export function claim(ledger: Ledger, index: number): number {
  ledger.next += 1;
  ledger.wanted.set(index, ledger.next);
  ledger.inFlight.add(ledger.next);
  ledger.failed.delete(index);
  return ledger.next;
}

/** The sector is no longer wanted. Its Worker job, if any, keeps its slot until it answers. */
export function release(ledger: Ledger, index: number) {
  ledger.wanted.delete(index);
  ledger.failed.delete(index);
}

const isLive = (ledger: Ledger, reply: Reply) =>
  ledger.wanted.get(reply.index) === reply.generation;

/** A Worker reply: frees its slot, and says whether its sector should be built. */
export function settle(ledger: Ledger, reply: Reply): Verdict {
  ledger.inFlight.delete(reply.generation);
  if (!isLive(ledger, reply)) return 'discard';
  if (reply.ok) return 'build';
  ledger.wanted.delete(reply.index);
  ledger.failed.set(reply.index, reply.now + RETRY_AFTER_S);
  return 'discard';
}

/** Whether an arrival may go on stage now. If so, its sector is no longer pending. */
export function place(ledger: Ledger, index: number, generation: number): boolean {
  if (ledger.wanted.get(index) !== generation) return false;
  ledger.wanted.delete(index);
  return true;
}

/** Sectors the planner must not request again yet: wanted, or failed and still backing off. */
export function busy(ledger: Ledger, now: number): number[] {
  for (const [index, until] of ledger.failed) if (until <= now) ledger.failed.delete(index);
  return [...ledger.wanted.keys(), ...ledger.failed.keys()];
}

/** Requests the Worker can take now. */
export const capacity = (ledger: Ledger, max: number) => Math.max(0, max - ledger.inFlight.size);
