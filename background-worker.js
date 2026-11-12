import { removeBackgroundAI } from './background-ai.js';
import { checkDimensions } from './image-header.js';
self.onmessage = async ({ data }) => {
  try {
    const { rgba, width, height } = data;
    checkDimensions(width, height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || !(rgba instanceof ArrayBuffer) || rgba.byteLength !== width * height * 4) throw new Error('Dữ liệu ảnh không hợp lệ.');
    const source = new OffscreenCanvas(width, height);
    source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const result = await removeBackgroundAI(source, { onProgress: ({ progress }) => self.postMessage({ progress: progress * 100 }) });
    const output = result.getContext('2d').getImageData(0, 0, width, height).data.buffer;
    self.postMessage({ rgba: output, width, height }, [output]);
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
