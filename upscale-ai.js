const MAX_PIXELS = 16_000_000;
const MAX_INPUT_EDGE = 4096;
const TILE = 64;
const OVERLAP = 8;
let queue = Promise.resolve();

// Keep transparent hidden RGB out of the model's receptive field.
export function compositeOnWhite(rgba) {
  const rgb = new Float32Array(rgba.length / 4 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const alpha = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[j + c] = rgba[i + c] * alpha + 255 * (1 - alpha);
  }
  return rgb;
}

export function uncompositeWhite(value, alpha) {
  return alpha === 0 ? 0 : Math.max(0, Math.min(255, (value - (255 - alpha)) * 255 / alpha));
}

// Pixel-center bilinear alpha, with clamped edges. Never use model-generated alpha.
export function resizeAlpha(rgba, width, height, scale) {
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const scaleX = outWidth / width, scaleY = outHeight / height;
  const alpha = new Uint8ClampedArray(outWidth * outHeight);
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) / scaleY - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + 0.5) / scaleX - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const top = rgba[(y0 * width + x0) * 4 + 3] * (1 - fx) + rgba[(y0 * width + x1) * 4 + 3] * fx;
      const bottom = rgba[(y1 * width + x0) * 4 + 3] * (1 - fx) + rgba[(y1 * width + x1) * 4 + 3] * fx;
      alpha[y * outWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return alpha;
}

// Estimate the model's matte coverage from the source foreground, not the restored
// alpha: independent RGB/alpha interpolation otherwise makes white boundary pixels.
export function recoverForeground(rgb, alpha, guide) {
  if (alpha === 0) return [0, 0, 0];
  if (alpha === 255) return rgb;
  const darkest = guide.indexOf(Math.min(...guide));
  // ponytail: near-white foreground has no reliable matte contrast; keep source
  // color there. A model with native alpha prediction would remove this ambiguity.
  if (guide[darkest] > 250) return guide;
  const coverage = Math.max(0, Math.min(255, (255 - rgb[darkest]) * 255 / (255 - guide[darkest])));
  if (coverage < 1) return guide;
  return rgb.map(value => uncompositeWhite(value, coverage));
}

function foregroundAt(rgba, width, height, x, y, scaleX, scaleY = scaleX) {
  const sx = Math.max(0, Math.min(width - 1, (x + 0.5) / scaleX - 0.5));
  const sy = Math.max(0, Math.min(height - 1, (y + 0.5) / scaleY - 0.5));
  const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
  const guide = [0, 0, 0];
  let weight = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const index = (Math.min(height - 1, y0 + dy) * width + Math.min(width - 1, x0 + dx)) * 4;
    const amount = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * rgba[index + 3];
    weight += amount;
    for (let c = 0; c < 3; c++) guide[c] += rgba[index + c] * amount;
  }
  return weight ? guide.map(value => value / weight) : guide;
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('AI upscaling cancelled.', 'AbortError');
}

function validate(canvas, scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0 || scale > 4) throw new RangeError('Mức phóng phải từ 0 đến 4.');
  const width = canvas?.width, height = canvas?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_INPUT_EDGE || height > MAX_INPUT_EDGE || typeof canvas.getContext !== 'function') {
    throw new RangeError(`Ảnh đầu vào AI phải từ 1 đến ${MAX_INPUT_EDGE} pixel mỗi chiều. Hãy cắt ảnh hoặc giảm kích thước trước khi dùng AI.`);
  }
  const target = scale || 1, w = Math.max(1, Math.round(width * target)), h = Math.max(1, Math.round(height * target));
  if (w > 10000 || h > 10000 || w * h > MAX_PIXELS) throw new RangeError('Ảnh đầu ra tối đa 10.000 pixel mỗi chiều và 16 triệu pixel. Hãy giảm mức phóng.');
}

async function selectBackend(tf, backend) {
  if (!await tf.setBackend(backend)) throw new Error(`TensorFlow ${backend} backend unavailable.`);
  await tf.ready();
  let probe;
  try {
    probe = tf.tidy(() => tf.conv2d(tf.ones([1, 3, 3, 1]), tf.ones([1, 1, 1, 1]), 1, 'valid'));
    const values = await probe.data();
    if (values.length !== 9 || !values.every(value => value === 1)) throw new Error('TensorFlow convolution check failed.');
  } finally {
    probe?.dispose();
  }
}

function reason(error) {
  return error instanceof Error ? error.message : String(error);
}

async function run(canvas, scale, { signal, onProgress, onBackend }) {
  validate(canvas, scale);
  checkAbort(signal);
  onProgress?.(0);
  const sourceContext = canvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Cannot read input canvas.');
  const { width, height } = canvas;
  const source = sourceContext.getImageData(0, 0, width, height);
  if (scale === 0) {
    const copy = document.createElement('canvas');copy.width = width;copy.height = height;
    const context = copy.getContext('2d');if (!context) throw new Error('Cannot create output canvas.');
    context.putImageData(source, 0, 0);onProgress?.(100);return copy;
  }
  if (scale < 1) {
    const reduced = document.createElement('canvas');
    reduced.width = Math.max(1, Math.round(width * scale));reduced.height = Math.max(1, Math.round(height * scale));
    const context = reduced.getContext('2d');if (!context) throw new Error('Cannot create output canvas.');
    const image = context.createImageData(reduced.width, reduced.height);
    const stepX = width / reduced.width, stepY = height / reduced.height;
    // Area filter averages premultiplied colors and alpha, preserving thin coverage.
    for (let y = 0; y < reduced.height; y++) {
      checkAbort(signal);
      for (let x = 0; x < reduced.width; x++) {
        const left=x*stepX,right=(x+1)*stepX,top=y*stepY,bottom=(y+1)*stepY;
        let alpha=0;const rgb=[0,0,0];
        for(let sy=Math.floor(top);sy<Math.ceil(bottom);sy++)for(let sx=Math.floor(left);sx<Math.ceil(right);sx++){
          const area=(Math.min(right,sx+1)-Math.max(left,sx))*(Math.min(bottom,sy+1)-Math.max(top,sy));
          const i=(Math.min(height-1,sy)*width+Math.min(width-1,sx))*4,a=source.data[i+3]*area;
          alpha+=a;for(let c=0;c<3;c++)rgb[c]+=source.data[i+c]*a;
        }
        const dest=(y*reduced.width+x)*4;
        for(let c=0;c<3;c++)image.data[dest+c]=alpha?rgb[c]/alpha:0;
        image.data[dest+3]=alpha/(stepX*stepY);
      }
      if(y%32===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    checkAbort(signal);context.putImageData(image,0,0);onProgress?.(100);return reduced;
  }
  const modelScale = scale <= 2 ? 2 : 4;
  checkAbort(signal);
  const { tf, Upscaler, AbortError } = await import('./vendor/upscale.js');
  checkAbort(signal);
  let backend = 'webgl';
  try {
    await selectBackend(tf, backend);
    checkAbort(signal);
    onBackend?.('WebGL · Tăng tốc GPU. Trình duyệt không xác định chắc GPU rời hay tích hợp. AI có thể đổi chi tiết; hãy so với ảnh gốc.');
  } catch (error) {
    checkAbort(signal);
    backend = 'cpu';
    onBackend?.(`CPU · WebGL không khả dụng: ${reason(error)}. AI chạy chậm hơn, có thể mất nhiều thời gian và thay đổi chi tiết ảnh.`);
    await selectBackend(tf, backend);
  }
  checkAbort(signal);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(width * scale));
  output.height = Math.max(1, Math.round(height * scale));
  const scaleX = output.width / width, scaleY = output.height / height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Cannot create output canvas.');
  const image = context.createImageData(output.width, output.height);
  const alpha = resizeAlpha(source.data, width, height, scale);
  const total = Math.ceil(width / TILE) * Math.ceil(height / TILE);
  let completed = 0;

  async function infer() {
    let upscaler;
    let inferenceStarted = false;
    let primaryError;
    try {
      checkAbort(signal);
      upscaler = new Upscaler({ model: {
        path: new URL(`./models/esrgan-slim/x${modelScale}/model.json`, import.meta.url).href,
        scale: modelScale, modelType: 'layers', inputRange: [0, 255], outputRange: [0, 255],
      } });
      await upscaler.ready;
      checkAbort(signal);
      for (let y = 0; y < height; y += TILE) {
        for (let x = 0; x < width; x += TILE) {
          checkAbort(signal);
          const left = Math.max(0, x - OVERLAP), top = Math.max(0, y - OVERLAP);
          const coreWidth = Math.min(TILE, width - x), coreHeight = Math.min(TILE, height - y);
          const patchWidth = Math.min(width, x + coreWidth + OVERLAP) - left;
          const patchHeight = Math.min(height, y + coreHeight + OVERLAP) - top;
          const rgba = new Uint8ClampedArray(patchWidth * patchHeight * 4);
          for (let row = 0; row < patchHeight; row++) {
            const start = ((top + row) * width + left) * 4;
            rgba.set(source.data.subarray(start, start + patchWidth * 4), row * patchWidth * 4);
          }
          // Upscaler 1.0.0 accepts RGB Tensor3D in 0–255. No internal patchSize:
          // it concatenates full TF outputs; outer tiling keeps GPU allocation bounded.
          // Scope also cleans upstream intermediate tensors on rejection/late abort.
          tf.engine().startScope();
          try {
            const input = tf.tensor3d(compositeOnWhite(rgba), [patchHeight, patchWidth, 3]);
            inferenceStarted = true;
            const tensor = await upscaler.upscale(input, { output: 'tensor', signal, awaitNextFrame: true });
            checkAbort(signal);
            if (tensor.shape.length !== 3 || tensor.shape[0] !== patchHeight * modelScale ||
                tensor.shape[1] !== patchWidth * modelScale || tensor.shape[2] !== 3) {
              throw new Error('Unexpected AI output tensor shape.');
            }
            const rgb = await tensor.data();
            checkAbort(signal);
            const patchW = patchWidth * modelScale, patchH = patchHeight * modelScale;
            for (let row = Math.round(y * scaleY); row < Math.round((y + coreHeight) * scaleY); row++) {
              for (let col = Math.round(x * scaleX); col < Math.round((x + coreWidth) * scaleX); col++) {
                const sx = Math.max(0, Math.min(patchW - 1, ((col + .5) / scaleX - left) * modelScale - .5));
                const sy = Math.max(0, Math.min(patchH - 1, ((row + .5) / scaleY - top) * modelScale - .5));
                const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
                const pixel = [0, 1, 2].map(c => {
                  const at = (px, py) => rgb[(py * patchW + px) * 3 + c];
                  return (at(x0,y0)*(1-fx)+at(Math.min(x0+1,patchW-1),y0)*fx)*(1-fy)
                    +(at(x0,Math.min(y0+1,patchH-1))*(1-fx)+at(Math.min(x0+1,patchW-1),Math.min(y0+1,patchH-1))*fx)*fy;
                });
                const dest = row * output.width + col, a = alpha[dest];
                if (!pixel.every(Number.isFinite)) throw new Error('AI output contains non-finite pixels.');
                const restored = a > 0 && a < 255 ? recoverForeground(pixel, a,
                  foregroundAt(source.data, width, height, col, row, scaleX, scaleY)) : pixel;
                for (let c = 0; c < 3; c++) image.data[dest * 4 + c] = a ? restored[c] : 0;
                image.data[dest * 4 + 3] = a;
              }
            }
          } finally {
            tf.engine().endScope();
          }
          completed++;
          onProgress?.(completed / total * 100);
          // CPU kernels cannot be preempted; let cancellation/UI run between tiles.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      return null;
    } catch (error) {
      primaryError = error;
      checkAbort(signal);
      if (AbortError && error instanceof AbortError) throw new DOMException('AI upscaling cancelled.', 'AbortError');
      if (backend !== 'webgl' || !inferenceStarted) throw error;
      return error;
    } finally {
      if (upscaler) {
        try { await upscaler.dispose(); }
        catch (error) { if (!primaryError) throw error; }
      }
    }
  }

  const gpuError = await infer();
  if (gpuError) {
    checkAbort(signal);
    backend = 'cpu';
    onBackend?.(`CPU · WebGL gặp lỗi, đang thử lại AI: ${reason(gpuError)}. Xử lý chậm hơn; ảnh vẫn ở trên thiết bị.`);
    await selectBackend(tf, backend);
    // Retry from tile zero. Preserve monotonic progress by counting only new work.
    const alreadyCompleted = completed;
    completed = 0;
    const report = onProgress;
    onProgress = value => { if (value > alreadyCompleted / total * 100) report?.(value); };
    await infer();
  }
  checkAbort(signal);
  context.putImageData(image, 0, 0);
  return output;
}

export async function upscaleAI(canvas, scale, options = {}) {
  validate(canvas, scale);
  checkAbort(options.signal);
  // TensorFlow backend and scopes are global. Serialize calls, including retries.
  const job = queue.then(() => run(canvas, scale, options));
  queue = job.catch(() => {});
  return job;
}
