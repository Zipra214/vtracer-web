import init, { convert_raw_rgba } from './pkg/vtracer_wasm.js';
import { presets, validateParams } from './trace-config.js';

self.onmessage = async ({ data }) => {
  try {
    const { rgba, width, height, preset, params, alpha, mode = 'spline', hierarchy = 'stacked' } = data;
    if (preset !== 'custom' && !Object.hasOwn(presets, preset)) throw new Error('Preset không hợp lệ.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > 10000 || height > 10000 || width * height > 16000000 ||
        !(rgba instanceof ArrayBuffer) || rgba.byteLength !== width * height * 4) throw new Error('Dữ liệu ảnh không hợp lệ.');
    if (!['preserve', 'white_background'].includes(alpha)) throw new Error('Xử lý alpha không hợp lệ.');
    if (!['spline', 'polygon', 'none'].includes(mode) || !['stacked', 'cutout'].includes(hierarchy)) throw new Error('Hình học không hợp lệ.');
    const p = validateParams(params || presets[preset]);
    await init();
    const svg = convert_raw_rgba(new Uint8Array(rgba), width, height, 'color', hierarchy, mode,
      p.filter_speckle, p.color_precision, p.layer_difference, p.corner_threshold,
      p.length_threshold, p.max_iterations, p.splice_threshold, p.path_precision, alpha);
    self.postMessage({ svg });
  } catch (error) { self.postMessage({ error: String(error?.message || error) }); }
};
