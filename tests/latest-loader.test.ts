import test from 'node:test';
import assert from 'node:assert/strict';

import { ServerMonitor } from '../src/app/connection.ts';
import { LatestLoader, type LoadState } from '../src/app/latest-loader.ts';

interface Deferred {
  key: string;
  signal: AbortSignal;
  resolve(value: string): void;
  reject(reason: unknown): void;
}

function harness() {
  const calls: Deferred[] = [];
  const states: LoadState<string, string>[] = [];
  const loader = new LatestLoader<string, string>(
    (key, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ key, signal, resolve, reject });
      }),
    (state) => states.push(state),
  );
  return { calls, states, loader };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('a slow answer for the previous campaign never reaches the current one', async () => {
  const { calls, states, loader } = harness();
  loader.open('a');
  loader.open('b');

  calls[1].resolve('data of b');
  await flush();
  calls[0].resolve('data of a');
  await flush();

  assert.deepEqual(states.at(-1), { status: 'ready', key: 'b', value: 'data of b' });
  assert.ok(!states.some((state) => state.status === 'ready' && state.key === 'a'));
});

test('a late failure of the previous campaign is not shown on the current one', async () => {
  const { calls, states, loader } = harness();
  loader.open('a');
  loader.open('b');

  calls[1].resolve('data of b');
  await flush();
  calls[0].reject(new Error('late failure'));
  await flush();

  assert.equal(states.at(-1)?.status, 'ready');
  assert.ok(!states.some((state) => state.status === 'failed'));
});

test('opening another key aborts the previous request and clears its data', async () => {
  const { calls, states, loader } = harness();
  loader.open('a');
  calls[0].resolve('data of a');
  await flush();

  loader.open('b');

  assert.deepEqual(states.at(-1), { status: 'loading', key: 'b' });
  loader.open('c');
  assert.equal(calls[1].signal.aborted, true);
});

test('reload repeats the open key and failures are published for it', async () => {
  const { calls, states, loader } = harness();
  const failure = new Error('down');
  loader.open('a');
  calls[0].reject(failure);
  await flush();
  assert.deepEqual(states.at(-1), { status: 'failed', key: 'a', error: failure });

  loader.reload();
  calls[1].resolve('recovered');
  await flush();

  assert.equal(calls[1].key, 'a');
  assert.deepEqual(states.at(-1), { status: 'ready', key: 'a', value: 'recovered' });
});

test('refresh keeps the current state on screen until the new answer arrives', async () => {
  const { calls, states, loader } = harness();
  loader.open('a');
  calls[0].resolve('first');
  await flush();
  const before = states.length;

  loader.refresh(() => assert.fail('no failure expected'));
  assert.equal(states.length, before);
  calls[1].resolve('second');
  await flush();

  assert.deepEqual(states.at(-1), { status: 'ready', key: 'a', value: 'second' });
});

test('a failed refresh reports to the caller and leaves the data in place', async () => {
  const { calls, states, loader } = harness();
  const reported: unknown[] = [];
  const failure = new Error('down');
  loader.open('a');
  calls[0].resolve('first');
  await flush();

  loader.refresh((error) => reported.push(error));
  calls[1].reject(failure);
  await flush();

  assert.deepEqual(reported, [failure]);
  assert.deepEqual(states.at(-1), { status: 'ready', key: 'a', value: 'first' });
});

test('after dispose neither reload nor refresh sends a request', () => {
  const { calls, loader } = harness();
  loader.open('a');
  loader.dispose();

  loader.reload();
  loader.refresh(() => assert.fail('no request expected'));

  assert.equal(calls.length, 1);
});

test('dispose aborts and silences the pending request', async () => {
  const { calls, states, loader } = harness();
  loader.open('a');
  const before = states.length;

  loader.dispose();
  calls[0].resolve('too late');
  await flush();

  assert.equal(calls[0].signal.aborted, true);
  assert.equal(states.length, before);
});

// The connection badge reuses the loader: health probes overlap when the interval and the
// browser's "online" event fire close together, and only the newest probe may set the badge.
interface PendingProbe {
  signal: AbortSignal;
  respond(body: unknown, ok?: boolean): void;
  fail(): void;
}

// Like fetch, a pending request rejects as soon as its signal aborts.
function healthHarness(timeoutMs = 5_000) {
  const requests: PendingProbe[] = [];
  const fetchStub = ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(signal.reason));
      requests.push({
        signal,
        respond: (body, ok = true) =>
          resolve({ ok, json: () => Promise.resolve(body) } as Response),
        fail: () => reject(new TypeError('network down')),
      });
    })) as typeof fetch;
  const seen: boolean[] = [];
  const monitor = new ServerMonitor(fetchStub, (reachable) => seen.push(reachable), timeoutMs);
  return { requests, seen, monitor };
}

test('a health probe that never answers times out as unreachable', async () => {
  const { requests, seen, monitor } = healthHarness(1);
  monitor.check();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(requests[0].signal.aborted);
  assert.deepEqual(seen, [false]);
});

const HEALTHY = { status: 'ok', service: 'desire-api', scope: 'local', protocol_version: 1 };

test('a slow failed health probe never overwrites a newer healthy answer', async () => {
  const { requests, seen, monitor } = healthHarness();
  monitor.check();
  monitor.check();

  requests[1].respond(HEALTHY);
  await flush();
  requests[0].fail();
  await flush();

  assert.deepEqual(seen, [true]);
  assert.ok(requests[0].signal.aborted, 'the older probe is aborted when a newer one starts');
});

test('a failed or malformed health probe reports the server as unreachable', async () => {
  const { requests, seen, monitor } = healthHarness();
  monitor.check();
  requests[0].fail();
  await flush();
  monitor.check();
  requests[1].respond({ unexpected: true });
  await flush();
  monitor.check();
  requests[2].respond(HEALTHY, false);
  await flush();

  assert.deepEqual(seen, [false, false, false]);
});

test('a disposed monitor publishes nothing and aborts its probe', async () => {
  const { requests, seen, monitor } = healthHarness();
  monitor.check();
  monitor.dispose();
  requests[0].respond(HEALTHY);
  await flush();

  assert.deepEqual(seen, []);
  assert.ok(requests[0].signal.aborted);
});
