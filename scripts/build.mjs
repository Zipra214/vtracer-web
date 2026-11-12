import { mkdir, cp, copyFile, access, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
// Only explicitly selected UI files enter the public artifact.
const root = new URL('../', import.meta.url);
const files = ['index.html','style.css','app.js','worker.js','trace-config.js','image-header.js','raster-worker.js','background-ai.js','background-worker.js','upscale-ai.js','geometry.js','export.js','favicon.svg','LICENSE','THIRD_PARTY_NOTICES.md'];
await mkdir(new URL('_site/', root), { recursive: true });
for (const file of files) await copyFile(new URL(file, root), new URL('_site/'+file, root));
for (const dir of ['vendor','models','licenses']) await cp(new URL(dir, root), new URL('_site/'+dir, root), { recursive: true });
await mkdir(new URL('_site/pkg/', root), { recursive: true });
for (const file of ['vtracer_wasm.js','vtracer_wasm_bg.wasm']) await copyFile(new URL('pkg/'+file, root), new URL('_site/pkg/'+file, root));
for (const file of ['vendor/pdf.js','vendor/upscale.js','vendor/ort/ort.min.mjs','vendor/ort/ort-wasm-simd-threaded.mjs','vendor/ort/ort-wasm-simd-threaded.wasm','models/u2netp.onnx','models/esrgan-slim/x2/model.json','models/esrgan-slim/x4/model.json']) await access(new URL('_site/'+file, root));
const ui = 'opendesign/mockups/vectorizer-reference/';
const uiFiles = ['index.html','reference.js','reference.css','workspace.css','palette-model.js',
  'assets/schibsted-latin.woff2','assets/schibsted-latin-ext.woff2',
  ...['kitten-photo.webp','kitten-illustration.webp','lavender-background.webp'].map(name=>'assets/welcome-sunburst-20261111/final/'+name)];
for (const file of uiFiles) {
  const target = new URL('_site/'+ui+file, root);
  await mkdir(new URL('.', target), { recursive: true });
  await copyFile(new URL(ui+file, root), target);
}
const landing = (await readFile(new URL(ui+'index.html', root), 'utf8')).replace(/\b(src|href)="(?!#|\/|[a-z][a-z\d+.-]*:)([^"]+)"/gi, (_, attribute, value) => `${attribute}="${new URL(value, 'https://build.invalid/'+ui).pathname.slice(1)}${new URL(value, 'https://build.invalid/'+ui).search}"`);
await writeFile(new URL('_site/index.html', root), landing);
assert.doesNotMatch(landing, /http-equiv="refresh"/);
assert.match(landing, /href="favicon\.svg"/);
assert.ok(landing.includes(`src="${ui}reference.js?`));
for (const [, value] of landing.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)) await access(new URL('_site/'+value.split('?')[0], root));
for (const file of uiFiles) await access(new URL('_site/'+ui+file,root));
assert.ok(!existsSync(new URL('_site/'+ui+'assets/welcome-sunburst-20261111/source/',root)), 'Source artwork must not ship');
console.log('Approved UI packaged in _site; no source images, node_modules, or backups included.');
