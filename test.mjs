import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { checkDimensions, imageDimensions } from './image-header.js';
import { presets, fields, validateParams } from './trace-config.js';

for (const preset of Object.values(presets)) {
  assert.deepEqual(['corner_threshold','length_threshold','splice_threshold','path_precision','max_iterations'].map(key=>preset[key]), [85,1,30,5,20]);
}
const elements = new Map(), events = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, {
    id, value: '', checked: false, dataset: {}, style: {}, hidden: true,
    listeners: new Map(), children: [],
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; },
    replaceChildren(...children) { this.children = children; },
    getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; },
    closest(selector) { return selector === '.adv-grid' && id.startsWith('adv-') ? {} : null; },
  });
  return elements.get(id);
};
const steps = [1, 2, 3, 4].map(n => {
  const button = element(`nav-${n}`); button.dataset.step = String(n); return button;
});
let decodes = 0, terminate = 0, objectUrls = 0, decodeGate, blobGate;
const revoked = [], workers = [];
function mockCanvas() {
  const ctx = {
    drawImage() {}, putImageData() {},
    getImageData(_x, _y, width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
  };
  return {
    width: 0, height: 0, getContext: () => ctx,
    toBlob(callback) { if (blobGate) blobGate(callback); else callback(new Blob(['PNG'], { type: 'image/png' })); },
  };
}
const context = vm.createContext({
  Blob, Error, DOMException, AbortController, clearTimeout, setTimeout,
  checkDimensions, imageDimensions, presets, fields, validateParams,
  optimizeGeometry() { throw new Error('Geometry not exercised by integration tests'); },
  document: {
    getElementById: element,
    querySelectorAll: selector => selector === '[data-step]' ? steps : [],
    querySelector: () => ({ value: 'preserve' }),
    createElement(tag) { assert.equal(tag, 'canvas'); return mockCanvas(); },
  },
  window: { addEventListener: (name, callback) => events.set(name, callback) },
  URL: class extends URL {
    static createObjectURL() { return `blob:test-${++objectUrls}`; }
    static revokeObjectURL(url) { revoked.push(url); }
  },
  Image: class {
    naturalWidth = 100; naturalHeight = 200;
    async decode() { decodes++; if (decodeGate) await decodeGate; }
  },
  Worker: class {
    constructor() { workers.push(this); }
    postMessage(payload) { this.payload = payload; }
    terminate() { terminate++; }
  },
});
element('preset').value = 'don_gian'; element('compare').value = '50';
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const imports = source.match(/^import .* from ['"][^'"]+['"];\r?$/gm) || [];
assert.equal(imports.length, 3, 'update VM bindings when app static imports change');
// Keep real app functions/handlers; inject imported modules and replace only module metadata.
vm.runInContext(source.replace(/^import .* from ['"][^'"]+['"];\r?\n/gm, '')
  .replaceAll('import.meta.url', '"file:///app.js"'), context);
const parse = buffer => imageDimensions(buffer);
const evaluate = code => vm.runInContext(code, context);
const fire = (id, name, event = { target: element(id) }) => element(id).listeners.get(name)(event);
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  assert.ok(predicate(), 'expected async checkpoint reached');
}
const make = (size) => new DataView(new ArrayBuffer(size));
function png(w, h) {
  const v = make(33);
  for (const [offset, value] of [[0, 0x89504e47], [4, 0x0d0a1a0a], [8, 13], [12, 0x49484452], [16, w], [20, h]]) v.setUint32(offset, value);
  v.setUint8(24, 8); v.setUint8(25, 2);
  return v.buffer;
}
function jpeg(w, h, marker = 0xc0) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0,
    0xff, marker, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]).buffer;
}
function webp(w, h, kind) {
  const v = make(kind === 'VP8L' ? 26 : 30);
  v.setUint32(0, 0x52494646); v.setUint32(4, v.byteLength - 8, true);
  v.setUint32(8, 0x57454250);
  v.setUint32(12, { VP8: 0x56503820, VP8L: 0x5650384c, VP8X: 0x56503858 }[kind]);
  v.setUint32(16, kind === 'VP8L' ? 5 : 10, true);
  if (kind === 'VP8') {
    v.setUint8(23, 0x9d); v.setUint16(24, 0x012a);
    v.setUint16(26, w, true); v.setUint16(28, h, true);
  } else if (kind === 'VP8L') {
    v.setUint8(20, 0x2f); v.setUint32(21, (w - 1) | ((h - 1) << 14), true);
  } else {
    v.setUint16(24, (w - 1) & 65535, true); v.setUint8(26, (w - 1) >>> 16);
    v.setUint16(27, (h - 1) & 65535, true); v.setUint8(29, (h - 1) >>> 16);
  }
  return v.buffer;
}
function bmp(w, h, dib = 40) {
  const v = make(14 + dib + 4);
  v.setUint16(0, 0x424d); v.setUint32(2, v.byteLength, true);
  v.setUint32(10, 14 + dib, true); v.setUint32(14, dib, true);
  if (dib === 12) {
    v.setUint16(18, w, true); v.setUint16(20, h, true);
    v.setUint16(22, 1, true); v.setUint16(24, 24, true);
  } else {
    v.setInt32(18, w, true); v.setInt32(22, h, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  }
  return v.buffer;
}
const formats = [png, jpeg, (w, h) => jpeg(w, h, 0xc2),
  ...['VP8', 'VP8L', 'VP8X'].map((kind) => (w, h) => webp(w, h, kind)), bmp];
for (const format of formats) {
  assert.deepEqual(parse(format(100, 200)), [100, 200]);
  assert.deepEqual(parse(format(4000, 4000)), [4000, 4000]);
  assert.deepEqual(parse(format(10000, 1)), [10000, 1]);
  for (const [w, h] of [[10001, 1], [1, 10001], [4001, 4000]]) {
    const buffer = format(w, h);
    assert.throws(() => parse(buffer), /Ảnh tối đa/);
    const before = decodes;
    await context.loadFile(new Blob([buffer], { type: 'image/png' }));
    assert.equal(decodes, before, 'oversize rejected before decode');
  }
  const valid = format(100, 200);
  for (let length = 0; length < valid.byteLength - (format === bmp ? 3 : 0); length++) {
    assert.throws(() => parse(valid.slice(0, length)), /Header ảnh|Chỉ nhận/);
  }
}
assert.deepEqual(parse(bmp(100, -200)), [100, 200]);
assert.deepEqual(parse(bmp(100, 200, 12)), [100, 200]);
for (const buffer of [png(0, 10), jpeg(10, 0), bmp(-1, 10)]) assert.throws(() => parse(buffer), /Ảnh tối đa/);
for (const text of ['GIF89a', '<svg></svg>', 'not an image']) {
  const before = decodes;
  await context.loadFile(new Blob([text], { type: 'image/png' }));
  assert.equal(decodes, before);
  assert.match(element('status').textContent, /Chỉ nhận/);
}
await context.loadFile(new Blob([png(100, 200)], { type: '' }));
assert.equal(decodes, 1);
assert.equal(element('convert').disabled, false);
const corrupt = webp(100, 200, 'VP8L');
new DataView(corrupt).setUint8(24, 0xe0);
assert.throws(() => parse(corrupt), /Header ảnh/);
assert.throws(() => parse(Uint8Array.from([255, 216, 255, 225, 0, 1]).buffer), /Header ảnh/);
const longJpeg = new Uint8Array(20 * 1024 * 1024);
longJpeg.set([255, 216]); longJpeg.fill(255, 2);
assert.throws(() => parse(longJpeg.buffer), /Header ảnh/);
await context.loadFile(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]));
assert.match(element('status').textContent, /20 MB/);

// Every preset synchronizes all eight fields, including previously hidden thresholds.
assert.equal(Object.keys(fields).length, 8);
for (const [key, preset] of Object.entries(presets)) {
  element('preset').value = key;
  fire('options', 'change', { target: element('preset') });
  for (const [name, [id]] of Object.entries(fields)) assert.equal(Number(element(id).value), preset[name]);
  assert.deepEqual(context.getAdvancedParams(), preset);
}
for (const name of ['filter_speckle', 'layer_difference', 'corner_threshold', 'splice_threshold']) {
  element(fields[name][0]).value = '0';
}
element('adv-path').value = '-1'; element('adv-length').value = '0.1';
const zeroParams = context.getAdvancedParams();
for (const name of ['filter_speckle', 'layer_difference', 'corner_threshold', 'splice_threshold']) assert.equal(zeroParams[name], 0);
assert.equal(zeroParams.path_precision, -1); assert.equal(zeroParams.length_threshold, .1);
const customValues = Object.fromEntries(Object.entries(fields).map(([key, [id]]) => [key, element(id).value]));
fire('options', 'change', { target: element('adv-speckle') });
assert.equal(element('preset').value, 'custom');
fire('options', 'change', { target: element('preset') });
assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, [id]]) => [key, element(id).value])), customValues);
for (const [name, [id, min, max]] of Object.entries(fields)) {
  const saved = element(id).value;
  for (const invalid of ['', ' ', 'NaN', 'Infinity', String(min - 1), String(max + 1), ...(name === 'length_threshold' ? [] : ['1.5'])]) {
    element(id).value = invalid;
    assert.throws(() => context.getAdvancedParams(), new RegExp(name));
  }
  element(id).value = saved;
}
assert.equal(element('upscale-before-trace').checked, false);

// Busy controls prevent overlapping loads; cancellation/pagehide invalidate delayed reads.
for (const cancel of [() => fire('cancel', 'click'), () => events.get('pagehide')()]) {
  let releaseRead;
  const delayed = new Blob([png(100, 200)]);
  delayed.arrayBuffer = () => new Promise(resolve => { releaseRead = resolve; });
  const previousSource = element('source').src, beforeUrls = objectUrls, beforeDecodes = decodes;
  const pending = context.loadFile(delayed);
  assert.equal(element('previews')['aria-busy'], 'true');
  assert.equal(element('convert').disabled, true);
  assert.equal(element('file').disabled, true);
  assert.equal(element('cancel').hidden, false);
  assert.ok(steps.every(button => button.disabled));
  await context.loadFile(new Blob([png(100, 200)]));
  assert.equal(decodes, beforeDecodes, 'busy load ignored');
  cancel();
  const cancelledStatus = element('status').textContent;
  assert.equal(element('previews')['aria-busy'], 'false');
  assert.equal(element('convert').disabled, false, 'previous image stays usable');
  assert.equal(element('cancel').hidden, true);
  releaseRead(png(100, 200)); await pending;
  assert.equal(objectUrls, beforeUrls, 'stale read cannot create URL');
  assert.equal(decodes, beforeDecodes, 'stale read cannot decode');
  assert.equal(element('source').src, previousSource);
  assert.equal(element('status').textContent, cancelledStatus);
}

// A cancelled decode cannot overwrite a newer successfully loaded image.
let releaseDecode;
decodeGate = new Promise(resolve => { releaseDecode = resolve; });
const beforeDecode = decodes, staleDecode = context.loadFile(new Blob([png(100, 200)]));
await until(() => decodes > beforeDecode);
const staleUrl = `blob:test-${objectUrls}`;
fire('cancel', 'click'); decodeGate = undefined;
await context.loadFile(new Blob([png(100, 200)]));
const freshSource = element('source').src, freshStatus = element('status').textContent;
releaseDecode(); await staleDecode;
assert.equal(element('source').src, freshSource);
assert.equal(element('status').textContent, freshStatus);
assert.ok(revoked.includes(staleUrl), 'cancelled decode URL released');
assert.ok(!revoked.includes(freshSource), 'new active source remains valid');

// pagehide aborts/terminates active worker and rejects its pending operation.
let pendingWorker;
const workerJob = context.runTask(async current => {
  pendingWorker = context.workerCall('./raster-worker.js', { operation: 'test' }, current);
  await pendingWorker;
  context.guard(current);
  context.workerPublished = true;
});
const workerRejected = assert.rejects(pendingWorker, { name: 'AbortError' });
assert.equal(element('previews')['aria-busy'], 'true');
const beforeTerminate = terminate;
events.get('pagehide')(); await workerRejected; await workerJob;
assert.ok(terminate > beforeTerminate);
assert.equal(context.workerPublished, undefined);
assert.equal(element('previews')['aria-busy'], 'false');
assert.match(element('status').textContent, /Đã dừng tác vụ/);

// Cancel while PNG encoding is pending: late result must not publish or clear newer busy state.
let releaseBlob;
blobGate = callback => { releaseBlob = callback; };
const oldResult = element('result').src, beforePublishUrls = objectUrls;
const stalePreparation = context.runTask(async current => {
  await context.showPrepared(mockCanvas(), current);
  context.status('stale result');
});
assert.equal(typeof releaseBlob, 'function');
fire('cancel', 'click'); blobGate = undefined;
let releaseNew;
context.newGate = new Promise(resolve => { releaseNew = resolve; });
const newJob = context.runTask(async current => { await context.newGate; context.guard(current); });
releaseBlob(new Blob(['late PNG'])); await stalePreparation;
assert.equal(element('result').src, oldResult, 'cancelled result never published');
assert.equal(objectUrls, beforePublishUrls, 'cancelled encode creates no result URLs');
assert.equal(element('previews')['aria-busy'], 'true', 'old finally must not clear newer task');
assert.equal(element('convert').disabled, true);
assert.notEqual(element('status').textContent, 'stale result');
releaseNew(); await newJob;
assert.equal(element('previews')['aria-busy'], 'false');

// Palette selection must replace, not inherit, the previously selected region.
const createElement = context.document.createElement;
context.document.createElement = tag => tag === 'button' ? {
  style: {}, listeners: new Map(),
  setAttribute(name, value) { this[name] = value; },
  addEventListener(name, callback) { this.listeners.set(name, callback); },
} : createElement(tag);
context.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
element('path-select').add = option => element('path-select').children.push(option);
element('palette').append = button => element('palette').children.push(button);
function vectorFixture(fills) {
  const paths = fills.map(fill => ({
    attrs: { fill }, dataset: {},
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
  }));
  return {
    paths,
    querySelectorAll(selector) {
      return selector === 'path' ? paths : paths.filter(path => path.attrs['data-selected']);
    },
    cloneNode() { return vectorFixture(paths.map(path => path.attrs.fill)); },
  };
}
context.XMLSerializer = class {
  serializeToString(root) { return JSON.stringify(root.paths.map(path => path.attrs.fill)); }
};
context.previousVector = vectorFixture(['#FF0000', '#0000FF']);
evaluate('svgRoot = previousVector; renderEditor(); selectPath(0);');
assert.equal(evaluate('selectedColor'), '#FF0000');
element('palette').children.find(button => button.title === '#0000FF').listeners.get('click')();
assert.equal(evaluate('selectedPath'), -1);
assert.equal(evaluate('selectedColor'), '#0000FF');
assert.equal(element('region-color').value, '#0000FF');
assert.equal(element('palette').children.find(button => button.title === '#0000FF')['aria-pressed'], 'true');
element('region-color').value = '#00FF00';
fire('recolor-palette', 'click');
assert.deepEqual(context.previousVector.paths.map(path => path.attrs.fill), ['#FF0000', '#00FF00']);

// Reject both complexity limits before parsing, without replacing prior vector/history/download.
let parsedSvg = 0;
context.DOMParser = class {
  parseFromString() { parsedSvg++; throw new Error('Oversized SVG reached parser'); }
};
context.traceCanvas = Object.assign(mockCanvas(), { width: 1, height: 1 });
evaluate('globalThis.savedPrepare = prepare; prepare = async () => traceCanvas;');
try {
  for (const svg of ['x'.repeat(20_000_001), '<svg>' + '<path/>'.repeat(20_001) + '</svg>']) {
    const root = evaluate('svgRoot'), oldHistory = evaluate('history.slice()');
    const preview = element('vector-preview').children.slice();
    element('download').hidden = false; element('download').href = 'blob:previous-vector';
    const beforeWorkers = workers.length, pending = context.runTask(context.trace);
    await until(() => workers.length > beforeWorkers);
    workers.at(-1).onmessage({ data: { svg } });
    await pending;
    assert.equal(parsedSvg, 0, 'complex result rejected before DOMParser');
    assert.equal(evaluate('svgRoot'), root, 'previous vector remains editable');
    assert.deepEqual(evaluate('history.slice()'), oldHistory);
    assert.deepEqual(element('vector-preview').children, preview);
    assert.equal(element('download').href, 'blob:previous-vector');
    assert.equal(element('download').hidden, false);
    assert.equal(element('status').dataset.error, 'true');
    assert.match(element('status').textContent, /quá phức tạp/);
    assert.equal(element('previews')['aria-busy'], 'false');
  }
} finally {
  evaluate('prepare = savedPrepare;');
}

// Cropped raster uses centered aspect-preserving fit, matching SVG's default meet mapping.
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const rasterStyle = css.split('.stage img{')[1]?.split('}')[0] || '';
assert.ok(rasterStyle.includes('object-fit:contain'), 'raster crop preserves aspect ratio');
assert.ok(!rasterStyle.includes('object-position:'), 'default centered placement matches SVG xMidYMid');

console.log('Image headers, presets, cancellation, palette targeting, SVG complexity limits, and crop fit assertions passed.');

