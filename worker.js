import init, { convert_raw_rgba } from './pkg/vtracer_wasm.js';

const presets = {
  don_gian: [8, 4, 32, 75, 6, 60, 2],
  can_bang: [4, 6, 16, 60, 4, 45, 3],
  chi_tiet: [2, 8, 8, 45, 2, 30, 5],
};

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

self.onmessage = async ({ data }) => {
  try {
    const { rgba, width, height, preset, params, alpha } = data;
    if (preset !== 'custom' && !Object.hasOwn(presets, preset)) throw new Error('Preset không hợp lệ.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > 10000 || height > 10000 || width * height > 16000000 ||
        !(rgba instanceof ArrayBuffer) || rgba.byteLength !== width * height * 4) {
      throw new Error('Dữ liệu ảnh không hợp lệ.');
    }
    if (!['preserve', 'white_background'].includes(alpha)) throw new Error('Xử lý alpha không hợp lệ.');
    await init();
    let [speckle, precision, layer, corner, length, splice, path] = presets[preset] || presets.can_bang;
    if (params && typeof params === 'object') {
      speckle = clampInt(params.filter_speckle, 0, 100, speckle);
      precision = clampInt(params.color_precision, 1, 8, precision);
      layer = clampInt(params.layer_difference, 0, 255, layer);
      corner = clampInt(params.corner_threshold, 0, 180, corner);
      path = clampInt(params.path_precision, -1, 8, path);
    }
    const svg = convert_raw_rgba(new Uint8Array(rgba), width, height, 'color', 'stacked', 'spline',
      speckle, precision, layer, corner, length, 10, splice, path, alpha);
    self.postMessage({ svg });
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};

