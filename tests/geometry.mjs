// Run: node tests/geometry.mjs (no DOM, server, or dependencies required).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../geometry.js', import.meta.url));
const { classifyContour, optimizeGeometry } = await import(`data:text/javascript;base64,${source.toString('base64')}`);

const ellipse = (rx, ry, count = 256) => Array.from({ length: count }, (_, i) => {
    const angle = i * 2 * Math.PI / count;
    return { x: 12 + rx * Math.cos(angle), y: -8 + ry * Math.sin(angle) };
});
const polygon = vertices => vertices.flatMap((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    return Array.from({ length: 32 }, (_, j) => ({ x: a[0] + (b[0] - a[0]) * j / 32, y: a[1] + (b[1] - a[1]) * j / 32 }));
});
const rectangle = polygon([[0, 0], [40, 0], [40, 20], [0, 20]]);
assert.equal(classifyContour(ellipse(20, 20)), 'ellipse');
assert.equal(classifyContour(ellipse(40, 10)), 'ellipse');
assert.equal(classifyContour(rectangle), 'rectangle');
assert.equal(classifyContour(rectangle.toReversed()), 'rectangle');
assert.equal(classifyContour([...rectangle, rectangle[0]]), 'rectangle');
assert.equal(classifyContour([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }]), 'rectangle');
assert.equal(classifyContour(polygon([[0, 0], [40, 0], [20, 30]])), null);
const star = Array.from({ length: 10 }, (_, i) => {
    const angle = i * Math.PI / 5, radius = i % 2 ? 8 : 20;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
});
assert.equal(classifyContour(polygon(star)), null);
const blob = ellipse(20, 20).map((p, i) => {
    const factor = 1 + 0.08 * Math.sin(i * 14 * Math.PI / 256);
    return { x: 12 + (p.x - 12) * factor, y: -8 + (p.y + 8) * factor };
});
assert.equal(classifyContour(blob), null);
assert.equal(classifyContour(blob, { tolerance: 100 }), null);
// Rounded/missing corners and inward notches must not pass boundary-only tests.
assert.equal(classifyContour(polygon([[2, 0], [38, 0], [40, 2], [40, 18], [38, 20], [2, 20], [0, 18], [0, 2]])), null);
assert.equal(classifyContour(polygon([[0, 0], [18, 0], [20, 3], [22, 0], [40, 0], [40, 20], [0, 20]])), null);
assert.equal(classifyContour(polygon([[0, 0], [40, 20], [40, 0], [0, 20]])), null);
assert.equal(classifyContour([...rectangle, ...rectangle]), null);
assert.equal(classifyContour(ellipse(1, 20)), null);
assert.equal(classifyContour([]), null);
assert.equal(classifyContour([{ x: NaN, y: 1 }]), null);
assert.equal(classifyContour(rectangle.map(p => ({ x: p.x + 1e9, y: p.y - 1e9 }))), 'rectangle');
for (const tolerance of [0, -1, Infinity, NaN]) {
    assert.throws(() => classifyContour(rectangle, { tolerance }), RangeError);
    assert.throws(() => optimizeGeometry({}, { tolerance }), RangeError);
}
assert.throws(() => optimizeGeometry(null), TypeError);

// Minimal SVG DOM doubles exercise native sampling, skip guards, and d-only mutation.
function pathFixture(points, attrs = {}, overrides = {}) {
    const attributes = new Map(Object.entries({ d: 'M0,0 L40,0 L40,20 L0,20 Z', fill: '#c33', transform: 'translate(5,6)', ...attrs }));
    const segments = points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        return { p, q, length: Math.hypot(q.x - p.x, q.y - p.y) };
    });
    const length = segments.reduce((sum, segment) => sum + segment.length, 0);
    let samples = 0;
    const path = {
        styleValues: { fill: 'rgb(204, 51, 51)', stroke: 'none', transform: 'matrix(1, 0, 0, 1, 5, 6)' },
        getAttribute: name => attributes.get(name) ?? null,
        setAttribute: (name, value) => attributes.set(name, value),
        hasAttribute: name => attributes.has(name),
        removeAttribute: name => attributes.delete(name),
        closest: () => null,
        getTotalLength: () => length,
        getBBox: () => {
            const xs = points.map(p => p.x), ys = points.map(p => p.y);
            return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        },
        getPointAtLength: distance => {
            samples++;
            for (const segment of segments) {
                if (distance <= segment.length) {
                    const t = distance / segment.length;
                    return { x: segment.p.x + (segment.q.x - segment.p.x) * t, y: segment.p.y + (segment.q.y - segment.p.y) * t };
                }
                distance -= segment.length;
            }
            return points[0];
        },
        ...overrides,
    };
    return { path, attributes, samples: () => samples };
}
function run(fixtures, options, rootOverrides = {}) {
    const root = {
        getAttribute: () => null,
        ownerDocument: { defaultView: { getComputedStyle: node => node.styleValues ?? { transform: 'none' } } },
        querySelectorAll: selector => { assert.equal(selector, 'path'); return fixtures.map(f => f.path); },
        ...rootOverrides,
    };
    for (const fixture of fixtures) {
        let node = fixture.path;
        while (node.parentElement) node = node.parentElement;
        node.parentElement = root;
    }
    return optimizeGeometry(root, options);
}
const rect = pathFixture(rectangle);
const oval = pathFixture(ellipse(20, 10), { d: 'M32,-8 A20,10 0 1 1 -8,-8 A20,10 0 1 1 32,-8 Z' });
const rejected = pathFixture(blob);
assert.deepEqual(run([rect, oval, rejected]), { rectangles: 1, ellipses: 1, skipped: 1 });
assert.ok(rect.samples() >= 128);
assert.match(rect.attributes.get('d'), /^M0,0 L40,0 L40,20 L0,20 Z$/);
assert.equal((oval.attributes.get('d').match(/C/g) ?? []).length, 4);
assert.equal(oval.attributes.get('fill'), '#c33');
assert.equal(oval.attributes.get('transform'), 'translate(5,6)');
assert.equal(oval.attributes.size, 3);
function cubicContour(d) {
    const values = d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi).map(Number);
    let start = values.slice(0, 2);
    const points = [];
    for (let i = 2; i < values.length; i += 6) {
        const [ax, ay, bx, by, x, y] = values.slice(i, i + 6);
        for (let j = 0; j < 64; j++) {
            const t = j / 64, u = 1 - t;
            points.push({ x: u ** 3 * start[0] + 3 * u ** 2 * t * ax + 3 * u * t ** 2 * bx + t ** 3 * x,
                y: u ** 3 * start[1] + 3 * u ** 2 * t * ay + 3 * u * t ** 2 * by + t ** 3 * y });
        }
        start = [x, y];
    }
    assert.deepEqual(start, values.slice(0, 2));
    return points;
}
const emittedEllipse = cubicContour(oval.attributes.get('d'));
assert.equal(classifyContour(emittedEllipse), 'ellipse');
assert.ok(emittedEllipse[1].y > emittedEllipse[0].y);
const reverseOval = pathFixture(ellipse(20, 10).toReversed());
assert.equal(run([reverseOval]).ellipses, 1);
const emittedReverse = cubicContour(reverseOval.attributes.get('d'));
assert.equal(classifyContour(emittedReverse), 'ellipse');
assert.ok(emittedReverse[1].y < emittedReverse[0].y);
assert.equal(rejected.attributes.get('d'), 'M0,0 L40,0 L40,20 L0,20 Z');
const reverse = pathFixture(rectangle.toReversed());
assert.deepEqual(run([reverse]), { rectangles: 1, ellipses: 0, skipped: 0 });
assert.equal(reverse.attributes.get('d'), 'M0,0 L0,20 L40,20 L40,0 Z');
for (const d of ['M0 0L40 0L40 20L0 20', 'M0 0L40 0L40 20L0 20ZM10 10L20 10L20 15Z',
    'M0 0L40 0ZL40 20Z', 'M0 0X40 0Z', 'M0 0L40 0L40 Z', 'M0 0 A1 1 0 3 0 40 20Z', 'M0 0L1e999 0Z']) {
    const fixture = pathFixture(rectangle, { d });
    assert.equal(run([fixture]).skipped, 1, d);
    assert.equal(fixture.samples(), 0, d);
}
for (const transform of ['rotate(0)', 'scale(1)', 'matrix(1 0 0 1 0 0)', 'translate(1e999)', 'translate(0) skewX(1)']) {
    assert.equal(run([pathFixture(rectangle, { transform })]).skipped, 1, transform);
}
for (const transform of ['', 'translate(1)', 'translate(1, 2)', 'translate(1e2 -3) translate(.2,4)']) {
    assert.equal(run([pathFixture(rectangle, { transform })]).rectangles, 1, transform);
}
for (const styleValues of [
    { fill: 'none', stroke: 'none' }, { fill: 'url(#gradient)', stroke: 'none' },
    { fill: 'rgb(0, 0, 0)', stroke: 'red' }, { fill: 'red', stroke: 'none', markerStart: 'url(#marker)' },
    { fill: 'red', stroke: 'none', transform: 'matrix(2, 0, 0, 2, 0, 0)' },
    { fill: 'red', stroke: 'none', rotate: '20deg' },
]) assert.equal(run([pathFixture(rectangle, {}, { styleValues })]).skipped, 1);
const cssGeometry = pathFixture(rectangle, {}, { styleValues: { fill: 'red', stroke: 'none', d: 'path("M0 0L40 0L40 20L0 20Z")' } });
assert.equal(run([cssGeometry]).skipped, 1);
assert.equal(cssGeometry.attributes.get('d'), 'M0,0 L40,0 L40,20 L0,20 Z');
assert.equal(cssGeometry.samples(), 0);
const attributeCss = pathFixture(rectangle);
Object.defineProperty(attributeCss.path.styleValues, 'd', {
    get: () => attributeCss.attributes.has('d') ? 'path("M0 0L40 0L40 20L0 20Z")' : 'none',
});
assert.equal(run([attributeCss]).skipped, 1);
const presentationGeometry = pathFixture(rectangle);
Object.defineProperty(presentationGeometry.path.styleValues, 'd', {
    get: () => presentationGeometry.attributes.get('d') ? 'path("M0 0L40 0L40 20L0 20Z")' : 'none',
});
assert.equal(run([presentationGeometry]).rectangles, 1);
assert.equal(run([pathFixture(rectangle, { pathLength: '10' })]).skipped, 1);
assert.equal(run([pathFixture(rectangle, {}, { closest: () => ({}) })]).skipped, 1);
assert.equal(run([pathFixture(rectangle, {}, { parentElement: { getAttribute: () => 'scale(2)' } })]).skipped, 1);
const scaledStage = {
    getAttribute: () => null,
    get styleValues() { throw new Error('Outer HTML preview stage must not be inspected'); },
};
assert.deepEqual(run([pathFixture(rectangle), pathFixture(ellipse(20, 10))], undefined, {
    parentElement: scaledStage,
}), { rectangles: 1, ellipses: 1, skipped: 0 });
const outerScale = { getAttribute: () => null, styleValues: { transform: 'matrix(2, 0, 0, 2, 0, 0)' } };
assert.equal(run([pathFixture(rectangle)], undefined, { parentElement: outerScale }).rectangles, 1);
// SVG root and inner SVG groups remain subject to translate-only restrictions.
assert.equal(run([pathFixture(rectangle)], undefined, {
    parentElement: outerScale, styleValues: { transform: 'matrix(2, 0, 0, 2, 0, 0)' },
}).skipped, 1);
assert.equal(run([pathFixture(rectangle, {}, {
    parentElement: { getAttribute: () => null, styleValues: { transform: 'matrix(2, 0, 0, 2, 0, 0)' } },
})], undefined, { parentElement: outerScale }).skipped, 1);
assert.equal(run([pathFixture(rectangle, {}, { getTotalLength: () => 1e9 })]).skipped, 1);
assert.equal(run([pathFixture(rectangle, {}, { getBBox: () => { throw new Error('unavailable'); } })]).skipped, 1);
assert.equal(run([pathFixture(polygon([[0, 0], [3, 0], [3, 20], [0, 20]]))]).skipped, 1);
console.log('Geometry contour and SVG DOM regression checks passed');
