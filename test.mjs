import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const elements = new Map(), events = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, {
    dataset: {}, hidden: true, naturalWidth: 100, naturalHeight: 200,
    addEventListener() {}, removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; }, async decode() {},
  });
  return elements.get(id);
};
let decodes = 0, terminate = 0, objectUrls = 0;
const context = vm.createContext({
  Blob, Error, clearTimeout,
  document: { getElementById: element },
  window: { addEventListener: (name, callback) => events.set(name, callback) },
  URL: { createObjectURL() { objectUrls++; return 'blob:test'; }, revokeObjectURL() {} },
  Image: class {
    naturalWidth = 100; naturalHeight = 200;
    async decode() { decodes++; }
  },
});
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
// Replace only module metadata so real app functions and handlers run in Node's VM.
vm.runInContext(source.replaceAll('import.meta.url', '"file:///app.js"'), context);
const parse = (buffer) => Array.from(context.imageDimensions(buffer));
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

// pagehide stops workers and invalidates in-flight reads without stale busy text.
context.fakeWorker = { terminate() { terminate++; } };
vm.runInContext('ready = true; worker = fakeWorker; status("Đang vector hóa…"); controls();', context);
events.get('pagehide')();
assert.equal(terminate, 1);
assert.equal(element('previews')['aria-busy'], 'false');
assert.match(element('status').textContent, /Đã hủy/);
let release;
const delayed = new Blob([png(100, 200)]);
delayed.arrayBuffer = () => new Promise((resolve) => { release = resolve; });
const pending = context.loadFile(delayed), before = objectUrls;
events.get('pagehide')();
assert.equal(element('previews')['aria-busy'], 'false');
assert.match(element('status').textContent, /Đã dừng đọc ảnh/);
release(png(100, 200));
await pending;
assert.equal(objectUrls, before, 'stale read must not decode or create URL');
assert.equal(element('convert').disabled, true);

// Advanced controls sync and bounds tests
context.syncPresetToInputs('chi_tiet');
assert.equal(element('adv-speckle').value, 2);
assert.equal(element('adv-precision').value, 8);
assert.equal(element('adv-layer').value, 8);
assert.equal(element('adv-corner').value, 45);
assert.equal(element('adv-path').value, 5);
context.syncPresetToInputs('don_gian');
assert.equal(element('adv-speckle').value, 8);
assert.equal(element('adv-precision').value, 4);

const params = context.getAdvancedParams();
assert.equal(params.filter_speckle, 8);
assert.equal(params.color_precision, 4);
assert.equal(params.layer_difference, 32);
assert.equal(params.corner_threshold, 75);
assert.equal(params.path_precision, 2);

// Upscale checkbox defaults to OFF (false)
assert.equal(Boolean(element('upscale-before-trace').checked), false);

console.log('Image header, predecode limits, advanced parameters, and pagehide assertions passed.');

