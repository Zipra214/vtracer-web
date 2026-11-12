import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { removeBackground, quantize, sharpen } from '../raster-worker.js';

const image = (width, height, pixel) => Uint8ClampedArray.from(
  Array.from({ length: width * height }, (_, i) => pixel(i % width, Math.floor(i / width))).flat());
const alphaAt = (data, width, x, y) => data[(y * width + x) * 4 + 3];
const visibleColors = data => new Set(Array.from({ length: data.length / 4 }, (_, p) => p * 4)
  .filter(i => data[i + 3]).map(i => `${data[i]},${data[i + 1]},${data[i + 2]}`));

// Black closed ring separates white hole from border-connected white background.
const ring = image(5, 5, (x, y) => x === 0 || y === 0 || x === 4 || y === 4 || (x === 2 && y === 2)
  ? [255, 255, 255, 200] : [0, 0, 0, 150]);
const originalRing = ring.slice();
const removed = removeBackground(ring, 5, 5);
assert.equal(alphaAt(removed, 5, 0, 2), 0);
assert.equal(alphaAt(removed, 5, 2, 2), 200);
assert.equal(alphaAt(removed, 5, 1, 2), 150);
assert.equal(alphaAt(removeBackground(ring, 5, 5, { contiguous: false }), 5, 2, 2), 0);
assert.deepEqual(ring, originalRing, 'background removal must not mutate input');

const distances = new Uint8ClampedArray([245, 245, 245, 200, 235, 235, 235, 200, 225, 225, 225, 200]);
assert.deepEqual([...removeBackground(distances, 3, 1, { tolerance: 20 })].filter((_, i) => i % 4 === 3), [0, 0, 200]);
assert.equal(removeBackground(new Uint8ClampedArray([225, 255, 255, 255]), 1, 1,
  { tolerance: 18 })[3], 0, 'distance must divide RGB Euclidean distance by sqrt(3)');
assert.equal(removeBackground(new Uint8ClampedArray([240, 240, 240, 200]), 1, 1,
  { tolerance: 20, feather: 10 })[3], 100);
assert.equal(removeBackground(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1,
  { tolerance: 0, feather: 10 })[3], 0);
assert.equal(removeBackground(new Uint8ClampedArray([18, 52, 86, 255]), 1, 1,
  { color: '#123456', tolerance: 0 })[3], 0);
const transparentBridge = image(5, 5, (x, y) => y === 2 && x < 2 ? [12, 34, 56, 0]
  : x === 2 && y === 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
assert.equal(alphaAt(removeBackground(transparentBridge, 5, 5), 5, 2, 2), 0);
for (const [width, height] of [[1, 1], [1, 5], [5, 1]]) {
  assert.ok(removeBackground(image(width, height, () => [255, 255, 255, 255]), width, height)
    .every((value, i) => i % 4 !== 3 || value === 0));
}

const gradient = image(32, 16, (x, y) => [x * 8, y * 16, (x * 31 + y * 17) % 256, (x + y) % 3 ? 255 : 80]);
const originalGradient = gradient.slice();
for (const maxColors of [2, 7, 16, 64]) {
  const reduced = quantize(gradient, 32, 16, maxColors);
  assert.ok(visibleColors(reduced).size <= maxColors);
  assert.deepEqual(reduced, quantize(gradient, 32, 16, maxColors), 'quantization must be deterministic');
  for (let i = 3; i < gradient.length; i += 4) assert.equal(reduced[i], gradient[i]);
}
assert.deepEqual(gradient, originalGradient);
const transparent = new Uint8ClampedArray([10, 20, 30, 0, 255, 0, 0, 0]);
assert.deepEqual(quantize(transparent, 2, 1, 2), transparent);
const weighted = new Uint8ClampedArray([0, 0, 0, 255, 7, 7, 7, 1]);
assert.deepEqual([...quantize(weighted, 2, 1, 2)], [0, 0, 0, 255, 0, 0, 0, 1]);

const edge = image(3, 3, x => [x === 1 ? 160 : 80, 100, 140, x === 0 ? 90 : 255]);
const originalEdge = edge.slice();
const sharp = sharpen(edge, 3, 3, 1);
assert.notDeepEqual(sharp, edge, 'unsharp mask must change RGB pixels');
assert.ok(sharp[4] > edge[4]);
for (let i = 3; i < edge.length; i += 4) assert.equal(sharp[i], edge[i]);
assert.deepEqual(edge, originalEdge);
assert.deepEqual(sharpen(edge, 3, 3, 0), edge);
const isolated = image(3, 3, (x, y) => x === 1 && y === 1 ? [180, 120, 60, 100] : [0, 0, 0, 0]);
assert.deepEqual(sharpen(isolated, 3, 3, 2), isolated, 'transparent black must not create halos');
const hiddenWhite = isolated.slice();
for (let i = 0; i < hiddenWhite.length; i += 4) {
  if (!hiddenWhite[i + 3]) hiddenWhite.set([255, 255, 255], i);
}
assert.deepEqual(sharpen(hiddenWhite, 3, 3, 2), hiddenWhite, 'hidden RGB must not influence blur');

const tooWide = new Uint8ClampedArray(10001 * 4);
const tooLarge = new Uint8ClampedArray(4001 * 4000 * 4);
for (const operation of [removeBackground, quantize, sharpen]) {
  assert.throws(() => operation(tooWide, 10001, 1));
  assert.throws(() => operation(tooLarge, 4001, 4000));
  for (const [data, width, height] of [
    [new Uint8Array(4), 1, 1], [new Uint8ClampedArray(3), 1, 1],
    [new Uint8ClampedArray(4), 0, 1], [new Uint8ClampedArray(4), 1.5, 1],
    [new Uint8ClampedArray(4), 10001, 1], [new Uint8ClampedArray(4), 4001, 4000],
    [new Uint8ClampedArray(4), 1, Infinity],
  ]) assert.throws(() => operation(data, width, height));
}
assert.equal(sharpen(tooLarge.subarray(0, 4000 * 4000 * 4), 4000, 4000, 0).length, 64000000);
for (const operation of [removeBackground, quantize, sharpen]) {
  assert.equal(operation(new Uint8ClampedArray(10000 * 4), 10000, 1).length, 40000);
}
const pixel = new Uint8ClampedArray([255, 255, 255, 255]);
for (const options of [null, [], { color: '#fff' }, { color: 123 }, { tolerance: -1 },
  { tolerance: 151 }, { tolerance: NaN }, { tolerance: '30' }, { contiguous: 1 }, { feather: -1 }]) {
  assert.throws(() => removeBackground(pixel, 1, 1, options));
}
for (const value of [1, 65, 2.5, NaN, '8', null]) assert.throws(() => quantize(pixel, 1, 1, value));
for (const value of [-1, 2.1, Infinity, '1', null]) assert.throws(() => sharpen(pixel, 1, 1, value));

// Exercise guarded worker handler and real transfer semantics without browser or dependencies.
const source = await readFile(new URL('../raster-worker.js', import.meta.url), 'utf8');
const previous = Object.fromEntries(['WorkerGlobalScope', 'postMessage', 'onmessage'].map(key =>
  [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let response;
try {
  globalThis.WorkerGlobalScope = class {
    static [Symbol.hasInstance](value) { return value === globalThis; }
  };
  globalThis.postMessage = (message, transfer = []) => {
    response = structuredClone(message, { transfer });
    if (transfer.length) assert.equal(transfer[0].byteLength, 0, 'output buffer must transfer');
  };
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const operation of ['removeBackground', 'quantize', 'sharpen']) {
    globalThis.onmessage({ data: { id: operation, operation, rgba: pixel.slice().buffer, width: 1, height: 1 } });
    assert.equal(response.id, operation);
    assert.equal(response.rgba.byteLength, 4);
    assert.equal(response.width, 1);
    assert.equal(response.height, 1);
    if (operation === 'quantize') assert.deepEqual(response.palette, [[255, 255, 255]]);
  }
  for (const message of [null, { id: 12, operation: 'bad', rgba: pixel.buffer },
    { id: 13, operation: 'sharpen', rgba: pixel, width: 1, height: 1 },
    { id: 14, operation: 'quantize', rgba: pixel.buffer, width: 1, height: 1, options: null },
    { id: 15, operation: 'removeBackground', rgba: pixel.buffer, width: 0, height: 1 }]) {
    globalThis.onmessage({ data: message });
    assert.equal(response.id, message?.id);
    assert.equal(typeof response.error, 'string');
    assert.ok(response.error.length);
    assert.equal(response.rgba, undefined);
  }
} finally {
  for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log('Raster tests passed.');
