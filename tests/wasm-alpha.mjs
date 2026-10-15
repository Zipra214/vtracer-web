// Run: node tests/wasm-alpha.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A data URL loads wasm-bindgen's ESM without requiring package.json changes.
const source = readFileSync(new URL('../pkg/vtracer_wasm.js', import.meta.url));
const { initSync, convert_raw_rgba } = await import(
    `data:text/javascript;base64,${source.toString('base64')}`
);
initSync({ module: readFileSync(new URL('../pkg/vtracer_wasm_bg.wasm', import.meta.url)) });
const convert = (rgba, width, height, hierarchy, precision) => convert_raw_rgba(
    rgba, width, height, 'color', hierarchy, 'none', 0, precision,
    16, 60, 4, 10, 45, 2, 'preserve',
);

let checks = 0;
for (const rgb of [[254, 0, 254], [250, 5, 250]]) {
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let y = 8; y < 24; y++) {
        for (let x = 8; x < 24; x++) rgba.set([...rgb, 255], (y * 32 + x) * 4);
    }
    for (const precision of [1, 6, 8]) {
        for (const hierarchy of ['stacked', 'cutout']) {
            const svg = convert(rgba, 32, 32, hierarchy, precision);
            const hex = rgb.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
            assert.equal((svg.match(/<path/g) ?? []).length, 1, svg);
            assert.ok(svg.includes(`d="M0,0 L16,0 L16,16 L0,16 Z " fill="#${hex}" transform="translate(8,8)"`), svg);
            checks++;
        }
    }
}

const ring = new Uint8Array(32 * 32 * 4);
for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
        if (x < 8 || x >= 24 || y < 8 || y >= 24) ring.set([220, 40, 40, 255], (y * 32 + x) * 4);
    }
}
for (const hierarchy of ['stacked', 'cutout']) {
    const svg = convert(ring, 32, 32, hierarchy, 8);
    assert.equal((svg.match(/<path/g) ?? []).length, 1, svg);
    // Opposite winding leaves center unpainted under the nonzero fill rule.
    assert.ok(svg.includes('d="M0,0 L32,0 L32,32 L0,32 Z M8,8 L8,24 L24,24 L24,8 Z "'), svg);
    checks++;
}

const dense = new Uint8Array(64 * 65 * 4);
let index = 0;
for (let r = 0; r < 16; r++) {
    for (let g = 0; g < 16; g++) {
        for (let b = 0; b < 16; b++) {
            dense.set([r * 16, g * 16, b * 16, 255], index);
            index += 4;
        }
    }
}
for (const hierarchy of ['stacked', 'cutout']) {
    assert.ok(convert(dense, 64, 65, hierarchy, 4).includes('<path'));
    checks++;
}
console.log(`${checks} WASM alpha regression checks passed`);
