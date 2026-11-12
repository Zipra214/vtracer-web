// Run: node tests/background-ai.mjs (no browser, model, packages, or network).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleURL = new URL('../background-ai.js', import.meta.url);
const source = readFileSync(moduleURL, 'utf8');
// Keep browser API unchanged; substitute only lazy runtime import for offline tests.
const testSource = source.replace("await import('./vendor/ort/ort.min.mjs')", 'globalThis.__backgroundAITestORT')
    .replaceAll('import.meta.url', JSON.stringify(moduleURL.href));
const { preprocessRGBA, normalizeMask, resizeMask, applyMaskToRGBA, removeBackgroundAI } =
    await import(`data:text/javascript;base64,${Buffer.from(testSource).toString('base64')}`);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
const plane = 320 * 320;
const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];

// Constant RGB uses image maximum (128), never alpha (255) or fixed 255.
const constant = preprocessRGBA(new Uint8ClampedArray([128, 64, 32, 255]), 1, 1);
assert.equal(constant.length, 3 * plane);
for (let c = 0; c < 3; c++) {
    near(constant[c * plane], ([1, 0.5, 0.25][c] - mean[c]) / std[c]);
    assert.equal(constant[c * plane], constant[(c + 1) * plane - 1]);
}
assert.deepEqual(preprocessRGBA(new Uint8Array([128, 64, 32, 0]), 1, 1), constant);
const black = preprocessRGBA(new Uint8Array([0, 0, 0, 255]), 1, 1);
for (let c = 0; c < 3; c++) near(black[c * plane], -mean[c] / std[c]);
assert.ok(black.every(Number.isFinite));
const corners = preprocessRGBA(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]), 2, 1);
near(corners[0], (1 - mean[0]) / std[0]);
near(corners[319], -mean[0] / std[0]);
near(corners[plane + 319], (1 - mean[1]) / std[1]);

assert.deepEqual([...normalizeMask([2, 4, 6])], [0, 0.5, 1]);
for (const value of [0, 0.5, 1]) assert.deepEqual([...normalizeMask([value, value])], [value, value]);
assert.deepEqual([...normalizeMask([-3, -3])], [0, 0]);
assert.deepEqual([...normalizeMask([4, 4])], [1, 1]);
assert.deepEqual([...resizeMask([0, 1], 2, 1, 4, 1)], [0, 0.25, 0.75, 1]);
assert.deepEqual([...resizeMask([0, 1, 1, 0], 2, 2, 1, 1)], [0.5]);
assert.ok(resizeMask([0.5], 1, 1, 3, 2).every(value => value === 0.5));
const rgba = new Uint8ClampedArray([220, 100, 50, 128, 10, 20, 30, 0, 11, 22, 33, 255]);
const before = rgba.slice();
assert.deepEqual([...applyMaskToRGBA(rgba, [0.5, 1, 0])], [220, 100, 50, 64, 10, 20, 30, 0, 11, 22, 33, 0]);
assert.deepEqual(rgba, before);
assert.deepEqual([...applyMaskToRGBA(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]), [-1, 2])],
    [1, 2, 3, 0, 4, 5, 6, 128]);
assert.throws(() => preprocessRGBA(rgba, 0, 3), RangeError);
assert.throws(() => preprocessRGBA(rgba, 1, 1), RangeError);
assert.throws(() => preprocessRGBA([0, 0, 0, 255], 1, 1), TypeError);
assert.throws(() => normalizeMask([]), RangeError);
assert.throws(() => normalizeMask([NaN]), TypeError);
assert.throws(() => resizeMask([0], 2, 2, 1, 1), RangeError);
assert.throws(() => applyMaskToRGBA(rgba, [NaN, 1, 1]), TypeError);
assert.throws(() => applyMaskToRGBA(rgba, [1]), RangeError);

// Small canvas/runtime doubles exercise async cleanup, signal guards, names and RGB.
class Canvas {
    constructor(width, height, data = new Uint8ClampedArray(width * height * 4)) {
        Object.assign(this, { width, height, data });
    }
    getContext() {
        return {
            getImageData: () => ({ data: this.data.slice() }),
            createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: image => { this.data = image.data.slice(); },
        };
    }
}
const priorOffscreen = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = Canvas;
let released = 0, disposed = 0, runs = 0, createHook = () => {}, runHook = () => {};
const runtime = {
    env: { wasm: {} },
    Tensor: class {
        constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
        dispose() { disposed++; }
    },
    InferenceSession: {
        async create(url, options) {
            assert.equal(url, new URL('../models/u2netp.onnx', import.meta.url).href);
            assert.deepEqual(options, { executionProviders: ['wasm'] });
            await createHook();
            return {
                inputNames: ['first_input'], outputNames: ['first_output'],
                async run(feeds, names) {
                    runs++;
                    assert.deepEqual(Object.keys(feeds), ['first_input']);
                    assert.deepEqual(names, ['first_output']);
                    assert.deepEqual(feeds.first_input.dims, [1, 3, 320, 320]);
                    await runHook();
                    return { first_output: { dims: [1, 1, 320, 320], data: new Float32Array(plane).fill(0.5),
                        dispose() { disposed++; } } };
                },
                async release() { released++; },
            };
        },
    },
};
globalThis.__backgroundAITestORT = runtime;
try {
    const canvas = new Canvas(3, 1, rgba), events = [];
    const output = await removeBackgroundAI(canvas, { onProgress: event => events.push(event) });
    assert.notEqual(output, canvas);
    assert.deepEqual([...output.data], [220, 100, 50, 64, 10, 20, 30, 0, 11, 22, 33, 128]);
    assert.deepEqual(canvas.data, before);
    assert.deepEqual(events.map(e => e.stage), ['loading', 'preprocessing', 'inference', 'masking', 'done']);
    assert.ok(events.every((e, i) => e.progress >= 0 && e.progress <= 1 && (!i || e.progress >= events[i - 1].progress)));
    assert.equal(runtime.env.wasm.numThreads, 1);
    assert.equal(runtime.env.wasm.proxy, false);
    assert.equal(runtime.env.wasm.wasmPaths.mjs, new URL('../vendor/ort/ort-wasm-simd-threaded.mjs', import.meta.url).href);
    assert.equal(runtime.env.wasm.wasmPaths.wasm, new URL('../vendor/ort/ort-wasm-simd-threaded.wasm', import.meta.url).href);
    assert.equal(released, 1);
    assert.equal(disposed, 2);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(removeBackgroundAI(canvas, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(released, 1);
    const duringLoad = new AbortController();
    createHook = () => duringLoad.abort();
    await assert.rejects(removeBackgroundAI(canvas, { signal: duringLoad.signal }), { name: 'AbortError' });
    assert.equal(runs, 1);
    assert.equal(released, 2);
    createHook = () => {};
    const duringInference = new AbortController();
    runHook = () => duringInference.abort();
    await assert.rejects(removeBackgroundAI(canvas, { signal: duringInference.signal }), { name: 'AbortError' });
    assert.equal(released, 3);
    assert.equal(disposed, 4);
    runHook = () => { throw new Error('Inference failed'); };
    await assert.rejects(removeBackgroundAI(canvas), /Inference failed/);
    assert.equal(released, 4);
    assert.equal(disposed, 5);
    runHook = () => {};
    await assert.rejects(removeBackgroundAI(canvas, { onProgress: ({ stage }) => {
        if (stage === 'masking') throw new Error('Progress callback failed');
    } }), /Progress callback failed/);
    assert.equal(released, 5);
    assert.equal(disposed, 7);
} finally {
    if (priorOffscreen === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = priorOffscreen;
    delete globalThis.__backgroundAITestORT;
}
console.log('Background AI preprocessing, masks, alpha, lifecycle and cancellation checks passed');
