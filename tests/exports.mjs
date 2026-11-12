import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsePath, exportVector } from '../export.js';
const source = readFileSync(new URL('../export.js', import.meta.url), 'utf8');
assert.match(source, /import\('\.\/vendor\/pdf\.js'\)/); // local bundle, no CDN
assert.doesNotMatch(source, /html2canvas|addImage/); // no raster fallback for PDF
// Node 24 detects browser module syntax without requiring package.json.

assert.deepEqual(parsePath('m1 2 3 4 h5 v-2 l-1-1 z'), [
  ['M', 1, 2], ['L', 4, 6], ['L', 9, 6], ['L', 9, 4], ['L', 8, 3], ['Z'],
]);
assert.deepEqual(parsePath('M0 0 C1 2 3 4 5 6 s2 2 4 0 T12 10 q2 2 4 0 t4 0'), [
  ['M', 0, 0], ['C', 1, 2, 3, 4, 5, 6], ['C', 7, 8, 7, 8, 9, 6],
  ['Q', 9, 6, 12, 10], ['Q', 14, 12, 16, 10], ['Q', 18, 8, 20, 10],
]);
assert.deepEqual(parsePath('M1e1,-2.5E+1 L.5 1. Zm1 2'), [['M', 10, -25], ['L', 0.5, 1], ['Z'], ['M', 11, -23]]);
assert.deepEqual(parsePath('M0 0 Q1 2 3 4 L5 6 T7 8 S9 10 11 12'), [
  ['M', 0, 0], ['Q', 1, 2, 3, 4], ['L', 5, 6], ['Q', 5, 6, 7, 8], ['C', 7, 8, 9, 10, 11, 12],
]);
assert.deepEqual(parsePath('M1 1ZL2 2Z'), [['M', 1, 1], ['Z'], ['L', 2, 2], ['Z']]);
assert.deepEqual(parsePath(''), []);
for (const d of ['L1 2', 'M0', 'M0 0L', 'M0 0 A1 1 0 0 1 2 2', 'M0 0 R1 1', 'M0 0,', ',M0 0', 'M0,,0', 'M0 0, L1 1', 'M0 0 Z1 2', 'M0 0 LInfinity 1', 'M0 0 L1e100 1', 'M10000000 0l1 1']) {
  assert.throws(() => parsePath(d), Error, d);
}
assert.throws(() => parsePath(`M0 0${'L0 0'.repeat(500001)}`), /Too many/);

// Narrow DOM fixture shim tests conversion logic, not browser XML parsing.
class Element {
  constructor(localName, attrs = {}, children = []) {
    this.localName = localName; this.namespaceURI = 'http://www.w3.org/2000/svg';
    this.attrs = { ...attrs }; this.children = children;
  }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? String(this.attrs[name]) : null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  setAttribute(name, value) { this.attrs[name] = value; }
}
let fixture;
globalThis.DOMParser = class {
  parseFromString() { return { documentElement: fixture, querySelector: () => null }; }
};
const serialize = (el) => `<${el.localName} ${Object.entries(el.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${el.children.map(serialize).join('')}</${el.localName}>`;
globalThis.XMLSerializer = class { serializeToString(el) { return serialize(el); } };
const shape = (kind, attrs) => new Element(kind, attrs);
function svg(children, attrs = {}) {
  fixture = new Element('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 100 50', ...attrs }, children);
}
const triangle = () => shape('path', { d: 'M0 0L100 0L0 50Z', fill: '#f00', transform: 'translate(0,0)' });
svg([triangle()]);
let result = await exportVector('fixture', 'svg', { widthMm: 200 });
assert.equal(result.extension, 'svg'); assert.equal(result.blob.type, 'image/svg+xml');
assert.match(await result.blob.text(), /width="200mm" height="100mm"/);
assert.match(await result.blob.text(), /d="M0 0L100 0L0 50Z"/);
assert.match(await result.blob.text(), /preserveAspectRatio="xMidYMid meet"/);
svg([triangle()]);
result = await exportVector('fixture', 'svg', { heightMm: 75 });
assert.match(await result.blob.text(), /width="150mm" height="75mm"/);
svg([triangle()]);
result = await exportVector('fixture', 'eps', { widthMm: 25.4, heightMm: 25.4 });
let text = await result.blob.text();
assert.equal(result.extension, 'eps'); assert.match(text, /^%!PS-Adobe-3.0 EPSF-3.0/);
assert.match(text, /%%BoundingBox: 0 0 72 72/);
assert.match(text, /0 54 moveto\n72 54 lineto\n0 18 lineto/); // meet, centered; not stretched
assert.match(text, /1 0 0 setrgbcolor/);
assert.doesNotMatch(text, /\b(?:colorimage|image)\b/);
svg([new Element('g', { transform: 'translate(10 5)', fill: '#123' }, [shape('path', { d: 'M0 0 Q3 3 6 0Z', transform: 'translate(2,-1)', 'fill-rule': 'evenodd' })])]);
result = await exportVector('fixture', 'eps', { widthMm: 100, heightMm: 50 });
text = await result.blob.text(); assert.match(text, /curveto/); assert.match(text, /eofill/);
assert.match(text, /34\.015748 130\.3937008 moveto/);
svg([shape('path', { d: 'M0 0L10 0L0 10Z', fill: '#f00', opacity: '.5' })]);
result = await exportVector('fixture', 'eps');
assert.match(result.warnings.join(' '), /no alpha/);
assert.match(await result.blob.text(), /1 0\.5 0\.5 setrgbcolor/);
svg([shape('rect', { x: 1, y: 2, width: 3, height: 4, fill: '#000' }), shape('ellipse', { cx: 20, cy: 20, rx: 5, ry: 3 }), shape('circle', { cx: 40, cy: 20, r: 5 })]);
result = await exportVector('fixture', 'eps');
assert.equal((await result.blob.text()).match(/curveto/g).length, 8);
assert.match(result.warnings.join(' '), /0.028%/);
svg([triangle()]);
result = await exportVector('fixture', 'dxf', { widthMm: 100, heightMm: 50 });
text = await result.blob.text();
assert.match(text, /AC1009/); assert.match(text, /0\r\nPOLYLINE\r\n/); assert.match(text, /0\r\nVERTEX\r\n/);
assert.match(text, /70\r\n1\r\n/); assert.match(text, /0\r\nEOF\r\n$/);
assert.match(result.warnings.join(' '), /outlines only, no fills or transparency/);

// Curve flattening: independently sample source cubic and measure distance to resulting segments.
svg([shape('path', { d: 'M0 0 C0 50 100 50 100 0' })]);
result = await exportVector('fixture', 'dxf', { widthMm: 100, heightMm: 50, toleranceMm: 0.05 });
text = await result.blob.text();
const vertices = [...text.matchAll(/0\r\nVERTEX\r\n8\r\n0\r\n10\r\n([^\r]+)\r\n20\r\n([^\r]+)\r\n/g)].map((m) => [Number(m[1]), 50 - Number(m[2])]);
assert.ok(vertices.length > 10 && vertices.length < 200);
function distance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
for (let i = 0; i <= 1000; i++) {
  const t = i / 1000, u = 1 - t, point = [300 * u * t * t + 100 * t ** 3, 150 * u * u * t + 150 * u * t * t];
  assert.ok(Math.min(...vertices.slice(1).map((b, j) => distance(point, vertices[j], b))) <= 0.050001);
}
svg([shape('path', { d: 'M0 0Q50 50 100 0ZL100 50' })]);
result = await exportVector('fixture', 'dxf');
assert.equal((await result.blob.text()).match(/0\r\nPOLYLINE\r\n/g).length, 2);

for (const child of [shape('image', {}), shape('path', { d: 'M0 0L1 1', fill: 'url(#paint)' }), shape('path', { d: 'M0 0L1 1', stroke: '#fff' }), shape('path', { d: 'M0 0L1 1', transform: 'scale(2)' }), shape('path', { d: 'M0 0L1 1', opacity: '2' }), shape('path', { d: 'M0 0L1 1', style: 'filter: blur(1px)' }), shape('path', { d: 'M0 0L1 1', onclick: 'bad()' }), shape('rect', { width: 10, height: 10, rx: 1 }), new Element('g', { opacity: '.5' }, [triangle()])]) {
  svg([child]); await assert.rejects(exportVector('fixture', 'svg'), /Unsupported|unsupported|Invalid|Only translate/);
}
for (const options of [{ widthMm: 0 }, { heightMm: Infinity }, { widthMm: '100' }, { widthMm: 10001 }, { toleranceMm: 0 }]) {
  svg([triangle()]); await assert.rejects(exportVector('fixture', 'dxf', options), /Invalid/);
}
svg([triangle()], { viewBox: '0 0 0 50' });
await assert.rejects(exportVector('fixture', 'svg'), /viewBox/);
svg([triangle()]);
await assert.rejects(exportVector('<!DOCTYPE svg>fixture', 'svg'), /Invalid SVG/);
await assert.rejects(exportVector('fixture', 'jpg'), /Unsupported/);
await assert.rejects(exportVector('fixture', 'png', { resolution: 0 }), /Invalid/);
await assert.rejects(exportVector('fixture', 'png', { widthMm: 10000, resolution: 2400 }), /PNG exceeds/);
await assert.rejects(exportVector('fixture', 'png', { widthMm: 1270, heightMm: 1270, resolution: 96 }), /16 million/); // 4800²
await assert.rejects(exportVector('fixture', 'png', { widthMm: 2646, heightMm: 1, resolution: 96 }), /10000 pixels/);

// PNG sizing + alpha-preserving draw + cleanup, without browser encoder dependencies.
let revoked = 0, canvas;
// Valid 1x1 PNG; encoder dimensions tested through canvas stub separately.
const encodedPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
URL.createObjectURL = () => 'blob:fixture'; URL.revokeObjectURL = () => { revoked++; };
globalThis.Image = class { async decode() {} };
globalThis.document = { createElement() {
  canvas = { getContext: () => ({ drawImage() {} }), toBlob: (callback) => callback(new Blob([encodedPng], { type: 'image/png' })) };
  return canvas;
} };
svg([triangle()]);
result = await exportVector('fixture', 'png', { widthMm: 25.4, resolution: 300 });
assert.equal(canvas.width, 300); assert.equal(canvas.height, 150); assert.equal(revoked, 1);
assert.equal(result.blob.type, 'image/png');
const pngBytes = new Uint8Array(await result.blob.arrayBuffer()), pngView = new DataView(pngBytes.buffer);
assert.equal(pngView.getUint32(33), 9); assert.equal(pngView.getUint32(37), 0x70485973);
assert.equal(pngView.getUint32(41), 11811); assert.equal(pngView.getUint32(45), 11811);
assert.equal(pngBytes[49], 1); assert.equal(pngView.getUint32(50), crc32(pngBytes.subarray(37, 50)));
assert.equal(Math.abs(pngView.getUint32(41) * 0.0254 - 300) < 0.01, true);
await assert.rejects(exportVector('fixture', 'pdf', { widthMm: 6000 }), /PDF exceeds/);
globalThis.Image = class { async decode() { throw new Error('decode failed'); } };
await assert.rejects(exportVector('fixture', 'png'), /decode failed/); assert.equal(revoked, 2);
URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
console.log('PASS exports: normalized paths, SVG dimensions, vector EPS, bounded DXF curves, shape primitives, rejection, PNG sizing/cleanup');
