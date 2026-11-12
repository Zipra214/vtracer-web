function validateImage(data, width, height) {
  if (!(data instanceof Uint8ClampedArray) || !Number.isInteger(width) ||
      !Number.isInteger(height) || width < 1 || height < 1 || width > 10000 ||
      height > 10000 || width * height > 16000000 || data.length !== width * height * 4) {
    throw new TypeError('Invalid RGBA image (maximum 16MP, dimensions 1..10000).');
  }
}

function numberInRange(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}.`);
  }
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Options must be an object.');
  }
}

// Returns a fresh RGBA array; feather is a distance band inside tolerance (0..150).
export function removeBackground(data, width, height, options = {}) {
  validateImage(data, width, height);
  validateOptions(options);
  const { color = '#ffffff', tolerance = 30, contiguous = true, feather = 0 } = options;
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) {
    throw new TypeError('Background color must be #rrggbb.');
  }
  numberInRange(tolerance, 0, 150, 'Tolerance');
  numberInRange(feather, 0, 150, 'Feather');
  if (typeof contiguous !== 'boolean') throw new TypeError('Contiguous must be boolean.');
  const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
  const output = data.slice();
  const count = width * height;
  const threshold = tolerance * tolerance * 3;
  const distanceSquared = pixel => {
    const i = pixel * 4;
    return (data[i] - rgb[0]) ** 2 + (data[i + 1] - rgb[1]) ** 2 +
      (data[i + 2] - rgb[2]) ** 2;
  };
  const erase = pixel => {
    const i = pixel * 4 + 3;
    const distance = Math.sqrt(distanceSquared(pixel) / 3);
    // Exact matches always disappear, including tolerance=0.
    output[i] = feather > 0 && distance > 0
      ? data[i] * Math.max(0, Math.min(1, (distance - Math.max(0, tolerance - feather)) /
          Math.min(feather, tolerance || feather)))
      : 0;
  };
  if (!contiguous) {
    for (let pixel = 0; pixel < count; pixel++) {
      if (distanceSquared(pixel) <= threshold) erase(pixel);
    }
    return output;
  }

  const visited = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let end = 0;
  const visit = pixel => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    // Transparent pixels connect border background even when hidden RGB differs.
    if (data[pixel * 4 + 3] === 0 || distanceSquared(pixel) <= threshold) queue[end++] = pixel;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  for (let start = 0; start < end; start++) {
    const pixel = queue[start];
    erase(pixel);
    const x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x + 1 < width) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel + width < count) visit(pixel + width);
  }
  return output;
}

// Alpha-weighted median cut over a bounded 5-bit RGB histogram. Alpha is unchanged.
export function quantize(data, width, height, maxColors = 16) {
  validateImage(data, width, height);
  numberInRange(maxColors, 2, 64, 'Max colors');
  if (!Number.isInteger(maxColors)) throw new RangeError('Max colors must be an integer.');
  const weights = new Float64Array(32768);
  const sums = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];
  const keyAt = i => (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (!alpha) continue;
    const key = keyAt(i);
    weights[key] += alpha;
    for (let channel = 0; channel < 3; channel++) sums[channel][key] += data[i + channel] * alpha;
  }
  const points = [];
  for (let key = 0; key < weights.length; key++) {
    if (weights[key]) points.push({ key, weight: weights[key], rgb: sums.map(sum => sum[key] / weights[key]) });
  }
  const output = data.slice();
  if (!points.length) return output;
  const box = colors => {
    const ranges = [0, 1, 2].map(channel => {
      let min = 255, max = 0;
      for (const point of colors) {
        min = Math.min(min, point.rgb[channel]);
        max = Math.max(max, point.rgb[channel]);
      }
      return max - min;
    });
    const axis = ranges.indexOf(Math.max(...ranges));
    const weight = colors.reduce((sum, point) => sum + point.weight, 0);
    return { colors, axis, weight, score: colors.length > 1 ? weight * ranges[axis] : -1 };
  };
  const boxes = [box(points)];
  while (boxes.length < maxColors) {
    let selected = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].score >= 0 && (selected < 0 || boxes[i].score > boxes[selected].score)) selected = i;
    }
    if (selected < 0) break;
    const current = boxes[selected];
    current.colors.sort((a, b) => a.rgb[current.axis] - b.rgb[current.axis] || a.key - b.key);
    let split = 0, weight = 0;
    do { weight += current.colors[split++].weight; }
    while (split < current.colors.length - 1 && weight < current.weight / 2);
    boxes.splice(selected, 1, box(current.colors.slice(0, split)), box(current.colors.slice(split)));
  }
  const palette = boxes.map(current => [0, 1, 2].map(channel => Math.round(
    current.colors.reduce((sum, point) => sum + point.rgb[channel] * point.weight, 0) / current.weight)));
  const mapped = new Uint8Array(32768 * 3);
  for (const point of points) {
    let nearest = palette[0], best = Infinity;
    for (const color of palette) {
      const distance = color.reduce((sum, value, channel) => sum + (value - point.rgb[channel]) ** 2, 0);
      if (distance < best) { best = distance; nearest = color; }
    }
    mapped.set(nearest, point.key * 3);
  }
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const key = keyAt(i) * 3;
    output[i] = mapped[key];
    output[i + 1] = mapped[key + 1];
    output[i + 2] = mapped[key + 2];
  }
  return output;
}

// Mild 3x3 Gaussian unsharp mask, normalized by alpha to ignore hidden RGB.
export function sharpen(data, width, height, amount = 1) {
  validateImage(data, width, height);
  numberInRange(amount, 0, 2, 'Amount');
  const output = data.slice();
  if (!amount) return output;
  const kernel = [1, 2, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!data[i + 3]) continue;
      let weight = 0, red = 0, green = 0, blue = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(width - 1, x + dx));
          const j = (yy * width + xx) * 4;
          const w = kernel[dy + 1] * kernel[dx + 1] * data[j + 3];
          weight += w;
          red += data[j] * w;
          green += data[j + 1] * w;
          blue += data[j + 2] * w;
        }
      }
      output[i] = data[i] + amount * 0.5 * (data[i] - red / weight);
      output[i + 1] = data[i + 1] + amount * 0.5 * (data[i + 1] - green / weight);
      output[i + 2] = data[i + 2] + amount * 0.5 * (data[i + 2] - blue / weight);
    }
  }
  return output;
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({ data: message }) => {
    const id = message?.id;
    try {
      if (!message || typeof message !== 'object') throw new TypeError('Invalid worker message.');
      const { rgba, width, height, operation, options = {} } = message;
      if (!(rgba instanceof ArrayBuffer)) throw new TypeError('RGBA must be an ArrayBuffer.');
      validateOptions(options);
      const input = new Uint8ClampedArray(rgba);
      let data, palette;
      switch (operation) {
        case 'removeBackground': data = removeBackground(input, width, height, options); break;
        case 'quantize': {
          data = quantize(input, width, height, options.maxColors ?? 16);
          const colors = new Map();
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3]) {
              const key = data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
              if (!colors.has(key)) colors.set(key, [data[i], data[i + 1], data[i + 2]]);
            }
          }
          palette = [...colors.values()];
          break;
        }
        case 'sharpen': data = sharpen(input, width, height, options.amount ?? 1); break;
        default: throw new TypeError('Unknown raster operation.');
      }
      globalThis.postMessage({ id, rgba: data.buffer, width, height, ...(palette ? { palette } : {}) }, [data.buffer]);
    } catch (error) {
      globalThis.postMessage({ id, error: String(error?.message || error) });
    }
  };
}
