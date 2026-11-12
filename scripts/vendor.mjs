import { build } from 'esbuild';
import { mkdir, cp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = p => new URL(p, new URL('../', import.meta.url));
for (const p of ['vendor/ort','models','licenses/browser']) await mkdir(path(p), { recursive: true });
await build({ stdin: { contents: "export {jsPDF} from 'jspdf'; export {svg2pdf} from 'svg2pdf.js';", resolveDir: root }, bundle: true, minify: true, format: 'esm', platform: 'browser', outfile: fileURLToPath(path('vendor/pdf.js')), legalComments: 'eof' });
await build({ stdin: { contents: "export * as tf from '@tensorflow/tfjs'; export {default as Upscaler,AbortError} from 'upscaler';", resolveDir: root }, bundle: true, minify: true, format: 'esm', platform: 'browser', outfile: fileURLToPath(path('vendor/upscale.js')), legalComments: 'eof' });
await copyFile(path('node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'), path('vendor/ort/ort.min.mjs'));
for (const f of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) await copyFile(path('node_modules/onnxruntime-web/dist/'+f),path('vendor/ort/'+f));
for (const scale of [2,4]) await cp(path(`node_modules/@upscalerjs/esrgan-slim/models/x${scale}`),path(`models/esrgan-slim/x${scale}`),{recursive:true});
const modelHash = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
let bytes;
try { bytes = await readFile(path('models/u2netp.onnx')); } catch(error) { if(error.code !== 'ENOENT')throw error; }
if (!bytes) {
  const response = await fetch('https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx');
  if (!response.ok) throw new Error(`Model download: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== modelHash) throw new Error('U²-Net model checksum mismatch.');
  await writeFile(path('models/u2netp.onnx'),bytes,{flag:'wx'});
}
if (createHash('sha256').update(bytes).digest('hex') !== modelHash) throw new Error('U²-Net model checksum mismatch.');
for (const [src,dst] of [['upscaler/LICENSE','upscaler-MIT.txt'],['@upscalerjs/esrgan-slim/LICENSE','esrgan-slim-MIT.txt'],['jspdf/LICENSE','jspdf-MIT.txt'],['svg2pdf.js/LICENSE','svg2pdf-MIT.txt']]) await copyFile(path('node_modules/'+src),path('licenses/browser/'+dst));
for (const [url,name] of [
  ['https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.1/LICENSE','onnxruntime-MIT.txt'],
  ['https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.1/ThirdPartyNotices.txt','onnxruntime-ThirdPartyNotices.txt'],
  ['https://raw.githubusercontent.com/tensorflow/tfjs/tfjs-v4.11.0/LICENSE','tensorflow-Apache-2.0.txt'],
  ['https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/LICENSE','U2Net-Apache-2.0.txt'],
]) {
  try { await readFile(path('licenses/browser/'+name)); continue; } catch(error) { if(error.code!=='ENOENT')throw error; }
  const response=await fetch(url);if(!response.ok)throw new Error(`License ${name}: HTTP ${response.status}`);
  await writeFile(path('licenses/browser/'+name),await response.text(),{flag:'wx'});
}
console.log('Self-hosted PDF, ESRGAN, ONNX runtime and checksum-verified U²-Net ready.');
