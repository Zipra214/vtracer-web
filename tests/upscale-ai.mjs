// Run: node tests/upscale-ai.mjs (no npm, model download, or TensorFlow required).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../upscale-ai.js', import.meta.url), 'utf8');
// Only swap module boundary; no test hooks in production API.
const instrumented = source.replace("import('./vendor/upscale.js')", 'globalThis.__upscaleVendor()')
  .replaceAll('import.meta.url', "'https://example.test/app/upscale-ai.js'");
const { upscaleAI, compositeOnWhite, resizeAlpha, uncompositeWhite } = await import(
  `data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`
);
assert.deepEqual([...compositeOnWhite(new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255]))],
  [255, 255, 255, 10, 20, 30]);
for (const alpha of [1, 16, 64, 128, 254, 255]) {
  for (const channel of [0, 40, 128, 255]) {
    const matte = channel * alpha / 255 + 255 - alpha;
    assert.ok(Math.abs(uncompositeWhite(matte, alpha) - channel) < 1e-8);
  }
}
assert.equal(uncompositeWhite(255, 0), 0);
assert.equal(uncompositeWhite(-10, 128), 0);
assert.equal(uncompositeWhite(300, 128), 255);
assert.deepEqual([...resizeAlpha(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), 2, 1, 2)],
  [0, 64, 191, 255, 0, 64, 191, 255]);
assert.deepEqual([...resizeAlpha(new Uint8ClampedArray([0, 0, 0, 100]), 1, 1, 4)], Array(16).fill(100));

class Canvas {
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4).fill(255);
  }
  getContext() {
    return {
      getImageData: () => ({ data: this.data }),
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: image => { this.data = image.data; },
    };
  }
}
globalThis.document = { createElement: () => new Canvas() };
let state;
class AbortError extends Error {}
function reset(overrides = {}) {
  state = { backend: '', backends: [], imports: 0, disposed: 0, instances: 0, scopes: [], live: new Set(),
    inputs: [], model: null, failProbe: false, failGPU: false, failCPU: false, failLoad: false, controller: null,
    ...overrides };
}
function tensor(values, shape) {
  const result = { shape, values, data: async () => values, dispose() { state.live.delete(result); } };
  state.live.add(result);
  state.scopes.at(-1)?.push(result);
  return result;
}
const tf = {
  setBackend: async name => { state.backend = name; state.backends.push(name); return true; },
  ready: async () => {},
  tidy: fn => { const before = new Set(state.live); const output = fn();
    for (const item of state.live) if (!before.has(item) && item !== output) item.dispose(); return output; },
  ones: shape => tensor(new Float32Array(shape.reduce((a, b) => a * b)).fill(1), shape),
  conv2d: () => {
    if (state.backend === 'webgl' && state.failProbe) throw new Error('GPU convolution unsupported');
    return tensor(new Float32Array(9).fill(1), [1, 3, 3, 1]);
  },
  tensor3d: (values, shape) => tensor(values, shape),
  engine: () => ({ startScope: () => state.scopes.push([]), endScope: () => {
    for (const item of state.scopes.pop()) item.dispose();
  } }),
};
// Model probe intentionally throws inside tidy, so fake must clean exceptional temporaries too.
const tidy = tf.tidy;
tf.tidy = fn => { const before = new Set(state.live); try { return tidy(fn); } catch (error) {
  for (const item of state.live) if (!before.has(item)) item.dispose(); throw error;
} };
class Upscaler {
  constructor({ model }) { state.instances++; state.model = model;
    this.scale = model.scale; this.ready = state.failLoad ? Promise.resolve().then(() => {
      state.loadController?.abort(); throw new Error('model 404');
    }) : Promise.resolve(); }
  async upscale(input, options) {
    assert.equal(options.output, 'tensor');
    assert.equal(options.awaitNextFrame, true);
    assert.equal(options.patchSize, undefined);
    state.inputs.push(input.shape);
    // Simulate upstream temporaries leaked on prediction failure/late abort.
    tensor(new Float32Array(1), [1]);
    if (state.backend === 'webgl' && state.failGPU) { state.failGPU = false; throw new Error('GPU context lost'); }
    if (state.backend === 'cpu' && state.failCPU) throw new Error('CPU prediction failed');
    state.controller?.abort();
    const [height, width] = input.shape, scale = this.scale;
    const values = new Float32Array(height * width * scale * scale * 3);
    for (let y = 0; y < height * scale; y++) for (let x = 0; x < width * scale; x++) {
      const src = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 3;
      values.set(input.values.subarray(src, src + 3), (y * width * scale + x) * 3);
    }
    return tensor(values, [height * scale, width * scale, 3]);
  }
  async dispose() { state.disposed++; await this.ready; }
}
globalThis.__upscaleVendor = async () => { state.imports++; return { tf, Upscaler, AbortError }; };
const noLeaks = () => { assert.equal(state.live.size, 0); assert.equal(state.scopes.length, 0);
  assert.equal(state.disposed, state.instances); };
reset();
for (const scale of [-1, NaN, Infinity, '2', 8]) await assert.rejects(upscaleAI(new Canvas(1, 1), scale), RangeError);
for (const [width, height, scale] of [[0, 1, 2], [4097, 1, 2], [1, 1.2, 2], [1001, 1000, 4]]) {
  await assert.rejects(upscaleAI({ width, height, getContext() {} }, scale), RangeError);
}
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(upscaleAI(new Canvas(1, 1), 2, { signal: cancelled.signal }), { name: 'AbortError' });
assert.equal(state.imports, 0);

reset();
const input = new Canvas(65, 67);
for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
  input.data.set([x * 3 % 256, y * 3 % 256, 77, 255], (y * input.width + x) * 4);
}
const progress = [], backends = [];
const output = await upscaleAI(input, 2, { onProgress: n => progress.push(n), onBackend: text => backends.push(text) });
assert.equal(output.width, 130); assert.equal(output.height, 134);
for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
  const src = (Math.floor(y / 2) * input.width + Math.floor(x / 2)) * 4;
  assert.deepEqual(output.data.slice((y * output.width + x) * 4, (y * output.width + x) * 4 + 4), input.data.slice(src, src + 4));
}
assert.deepEqual(progress, [0, 25, 50, 75, 100]);
assert.ok(backends[0].includes('WebGL'));
assert.ok(state.inputs.every(([h, w]) => h <= 80 && w <= 80));
assert.equal(state.model.path, 'https://example.test/app/models/esrgan-slim/x2/model.json');
assert.deepEqual(state.model.inputRange, [0, 255]); assert.deepEqual(state.model.outputRange, [0, 255]);
assert.equal(state.model.modelType, 'layers'); noLeaks();

reset();
await assert.rejects(upscaleAI(new Canvas(2501, 1), 4), RangeError);
assert.equal(state.imports, 0);
const transparent = new Canvas(1, 1); transparent.data.set([0, 0, 0, 0]);
const transparentOutput = await upscaleAI(transparent, 4);
assert.ok(transparentOutput.data.every(value => value === 0));
assert.equal(state.model.path, 'https://example.test/app/models/esrgan-slim/x4/model.json'); noLeaks();
reset();
const partial = new Canvas(1, 1); partial.data.set([40, 80, 120, 128]);
assert.deepEqual((await upscaleAI(partial, 2)).data.slice(0, 4), partial.data); noLeaks();

for (const failure of ['failProbe', 'failGPU']) {
  reset({ [failure]: true });
  const messages = [], numbers = [];
  await upscaleAI(new Canvas(2, 2), 2, { onBackend: text => messages.push(text), onProgress: n => numbers.push(n) });
  assert.deepEqual(state.backends, ['webgl', 'cpu']);
  assert.ok(messages.at(-1).includes(failure === 'failProbe' ? 'GPU convolution unsupported' : 'GPU context lost'));
  assert.ok(numbers.every((n, i) => n >= 0 && n <= 100 && (!i || n >= numbers[i - 1]))); noLeaks();
}
reset({ failGPU: true, failCPU: true });
await assert.rejects(upscaleAI(new Canvas(2, 2), 2), /CPU prediction failed/); noLeaks();
reset({ failLoad: true });
await assert.rejects(upscaleAI(new Canvas(2, 2), 2), /model 404/);
assert.deepEqual(state.backends, ['webgl']); noLeaks();
reset({ controller: new AbortController() });
await assert.rejects(upscaleAI(new Canvas(2, 2), 2, { signal: state.controller.signal }), { name: 'AbortError' });
assert.deepEqual(state.backends, ['webgl']); noLeaks();
reset({ failLoad: true, loadController: new AbortController() });
await assert.rejects(upscaleAI(new Canvas(1, 1), 2, { signal: state.loadController.signal }), { name: 'AbortError' });
noLeaks();
reset();
const mutable = new Canvas(1, 1);
const mutatedJob = upscaleAI(mutable, 2);
mutable.width = 4097;
await assert.rejects(mutatedJob, RangeError);
assert.equal(state.imports, 0);
reset();
const unchanged = new Canvas(3, 2);unchanged.data.set([12,34,56,78]);
const copy = await upscaleAI(unchanged, 0);assert.deepEqual(copy.data, unchanged.data);assert.equal(state.imports, 0);
for (const scale of [.1, .5, 1, 1.1, 1.5, 2.5, 3, 3.7, 4]) {
  reset();const flat = new Canvas(65, 67);
  for(let i=0;i<flat.data.length;i+=4)flat.data.set([40,80,120,128],i);
  const resized=await upscaleAI(flat,scale);
  assert.equal(resized.width,Math.max(1,Math.round(65*scale)));
  assert.equal(resized.height,Math.max(1,Math.round(67*scale)));
  for(let i=0;i<resized.data.length;i+=4)assert.deepEqual([...resized.data.slice(i,i+4)],[40,80,120,128]);
  if(scale<1)assert.equal(state.imports,0);else assert.equal(state.model.scale,scale<=2?2:4);noLeaks();
}
reset();
const stripes=new Canvas(100,1);
for(let x=0;x<100;x++)stripes.data.set(x%2?[0,0,0,255]:[255,255,255,0],x*4);
const filtered=await upscaleAI(stripes,.2);
for(let x=0;x<20;x++){assert.ok(Math.abs(filtered.data[x*4+3]-128)<=26);assert.equal(filtered.data[x*4],0);}
assert.equal(state.imports,0);
reset();
for (const color of [[0, 0, 0], [50, 100, 150], [255, 255, 255]]) {
  const boundary = new Canvas(2, 1);
  boundary.data.set([...color, 255, 0, 0, 0, 0]);
  const result = await upscaleAI(boundary, 2);
  assert.deepEqual([...result.data.filter((_, i) => i % 4 === 3)], [255, 191, 64, 0, 255, 191, 64, 0]);
  for (const x of [1, 2]) assert.deepEqual([...result.data.slice(x * 4, x * 4 + 3)], color);
  noLeaks();
}
reset();
await Promise.all([upscaleAI(new Canvas(1, 1), 2), upscaleAI(new Canvas(1, 1), 4)]);
assert.equal(state.instances, 2); noLeaks();
console.log('AI alpha, tile boundaries, limits, backend retries, abort, cleanup, and serialization checks passed.');
