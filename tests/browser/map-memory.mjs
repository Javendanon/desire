// Allocated-resource audit: PlayCanvas counters + real GL renderbuffer storage + CDP heap.
// Physical driver/compiler/swapchain overhead is outside browser allocation counters.
import assert from 'node:assert/strict';

const MIB = 1024 * 1024;
export const MEMORY_BUDGET = { graphics: 192 * MIB, cpu: 192 * MIB, combined: 320 * MIB };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recordRenderbuffer(gl, buffers, meter) {
  const sizes = { RGBA8: 4, SRGB8_ALPHA8: 4, RGB8: 3, RGBA16F: 8, RGBA32F: 16,
    R8: 1, R16F: 2, R32F: 4, RG8: 2, RG16F: 4, RG32F: 8,
    RGB16F: 6, RGB32F: 12, R11F_G11F_B10F: 4, RGB10_A2: 4,
    DEPTH_COMPONENT16: 2, DEPTH_COMPONENT24: 4, DEPTH_COMPONENT32F: 4,
    DEPTH24_STENCIL8: 4, DEPTH32F_STENCIL8: 8, STENCIL_INDEX8: 1 };
  const resource = gl.getParameter(gl.RENDERBUFFER_BINDING);
  const format = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT);
  const name = Object.keys(sizes).find((key) => gl[key] === format);
  if (!name) {
    meter.errors.push(`unmeasured renderbuffer format ${format}`);
    return;
  }
  const width = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH);
  const height = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_HEIGHT);
  const samples = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES);
  const bytes = width * height * Math.max(1, samples) * sizes[name];
  meter.current += bytes - (buffers.get(resource) ?? 0);
  buffers.set(resource, bytes);
  meter.peak = Math.max(meter.peak, meter.current);
  meter.allocations++;
  meter.formats[name] = (meter.formats[name] ?? 0) + 1;
}

function installRenderbufferMeter(record) {
  const buffers = new Map();
  const meter = { current: 0, peak: 0, allocations: 0, formats: {}, errors: [] };
  window.__renderbufferMemory = meter;
  const proto = WebGL2RenderingContext.prototype;
  for (const method of ['renderbufferStorage', 'renderbufferStorageMultisample']) {
    const original = proto[method];
    proto[method] = function (...args) {
      const result = original.apply(this, args);
      record(this, buffers, meter);
      return result;
    };
  }
  const originalDelete = proto.deleteRenderbuffer;
  proto.deleteRenderbuffer = function (resource) {
    meter.current -= buffers.get(resource) ?? 0;
    buffers.delete(resource);
    return originalDelete.call(this, resource);
  };
}

async function sampleHeap(send, sampler) {
  if (sampler.busy) return;
  sampler.busy = true;
  try {
    const reply = await send('Runtime.getHeapUsage');
    assert.ok(reply.result, JSON.stringify(reply.error));
    const heap = reply.result;
    const bytes = heap.usedSize + (heap.backingStorageSize ?? 0) + (heap.embedderHeapUsedSize ?? 0);
    sampler.peak = Math.max(sampler.peak, bytes);
    sampler.samples++;
  } catch (error) {
    sampler.errors.push(String(error));
  } finally {
    sampler.busy = false;
  }
}

async function observeGraphics(evaluate) {
  assert.ok(await evaluate('Boolean(window.__renderbufferMemory)'), 'GL meter must be installed');
  await evaluate(`(() => {
    window.__graphicsPeak = window.__waterdeep.viewer.memoryStats();
    window.__waterdeep.viewer.onFrame(() => {
      const current = window.__waterdeep.viewer.memoryStats();
      for (const key of Object.keys(current)) {
        window.__graphicsPeak[key] = Math.max(window.__graphicsPeak[key], current[key]);
      }
    });
  })()`);
}

function validateMemory(sampler, gpu) {
  assert.deepEqual(sampler.errors, [], 'CPU measurement failed');
  assert.deepEqual(gpu.renderbuffers.errors, [], 'unmeasured GL resources');
  assert.ok(sampler.samples > 20, 'representative heap samples required');
  assert.ok(gpu.tracked.textures > 0 && gpu.tracked.geometry > 0);
  assert.ok(gpu.renderbuffers.peak > 0, 'render targets must be included');
  // Sum independent maxima: conservative even if they occur on different frames.
  const graphicsPeak = Object.values(gpu.tracked).reduce((sum, bytes) => sum + bytes, 0) +
    gpu.renderbuffers.peak;
  assert.ok(graphicsPeak <= MEMORY_BUDGET.graphics, `graphics peak ${graphicsPeak}`);
  assert.ok(sampler.peak <= MEMORY_BUDGET.cpu, `CPU peak ${sampler.peak}`);
  assert.ok(graphicsPeak + sampler.peak <= MEMORY_BUDGET.combined, 'combined memory budget');
  return { budget: MEMORY_BUDGET, graphicsPeak, cpuPeak: sampler.peak,
    combinedPeak: graphicsPeak + sampler.peak, samples: sampler.samples, ...gpu };
}

export async function startMemoryAudit(send, evaluate) {
  await send('Page.enable');
  const installed = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${installRenderbufferMeter.toString()})(${recordRenderbuffer.toString()})`,
  });
  assert.ok(installed.result?.identifier, JSON.stringify(installed.error));
  const sampler = { peak: 0, samples: 0, busy: false, errors: [] };
  const timer = setInterval(() => void sampleHeap(send, sampler), 100);
  return {
    observe: () => observeGraphics(evaluate),
    async finish() {
      clearInterval(timer);
      while (sampler.busy) await sleep(20);
      await sampleHeap(send, sampler);
      const gpu = await evaluate(`({ tracked: window.__graphicsPeak,
        renderbuffers: window.__renderbufferMemory })`);
      return validateMemory(sampler, gpu);
    },
    stop() { clearInterval(timer); },
  };
}

async function retainedHeap(send) {
  await send('HeapProfiler.collectGarbage');
  const { result } = await send('Runtime.getHeapUsage');
  return result.usedSize + (result.backingStorageSize ?? 0) + (result.embedderHeapUsedSize ?? 0);
}

export async function sweepSectors(send, evaluate) {
  const ids = await evaluate('window.__waterdeep.viewer.places().map((place) => place.id)');
  const visited = new Set();
  const farCounts = new Set();
  const geometryBases = new Set();
  const retained = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const id of ids) {
      await evaluate(`window.__waterdeep.viewer.focusPlace(${JSON.stringify(id)})`);
      await sleep(1400);
      const { state, gpu } = await evaluate(`({ state: window.__waterdeep.check(),
        gpu: window.__waterdeep.viewer.memoryStats() })`);
      assert.ok(state.ok, `sector sweep failed at ${id}`);
      state.stats.sectors.resident.forEach((sector) => visited.add(sector));
      farCounts.add(state.stats.sectors.farInstances);
      // Two actual 64-byte instance matrices per detailed lot, all other geometry is stable.
      geometryBases.add(gpu.geometry - state.stats.sectors.detailedBuildings * 2 * 64);
    }
    retained.push(await retainedHeap(send));
  }
  assert.ok(visited.size > 30, `only ${visited.size} sectors visited`);
  assert.equal(farCounts.size, 1, 'the far shell must survive unload/reload');
  assert.equal(geometryBases.size, 1, 'old sector instance buffers must be released');
  assert.ok(retained[1] - retained[0] < 8 * MIB, 'retained CPU growth after an identical sweep');
  return { cycles: 2, waypoints: ids.length, visitedSectors: visited.size, retained };
}
