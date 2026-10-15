import init, { convert_raw_rgba } from './pkg/vtracer_wasm.js';

const presets = {
  don_gian: [8, 4, 32, 75, 6, 60, 2],
  can_bang: [4, 6, 16, 60, 4, 45, 3],
  chi_tiet: [2, 8, 8, 45, 2, 30, 5],
};

self.onmessage = async ({ data }) => {
  try {
    const { rgba, width, height, preset, alpha } = data;
    if (!Object.hasOwn(presets, preset)) throw new Error('Preset không hợp lệ.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > 10000 || height > 10000 || width * height > 16000000 ||
        !(rgba instanceof ArrayBuffer) || rgba.byteLength !== width * height * 4) {
      throw new Error('Dữ liệu ảnh không hợp lệ.');
    }
    if (!['preserve', 'white_background'].includes(alpha)) throw new Error('Xử lý alpha không hợp lệ.');
    await init();
    const [speckle, precision, layer, corner, length, splice, path] = presets[preset];
    const svg = convert_raw_rgba(new Uint8Array(rgba), width, height, 'color', 'stacked', 'spline',
      speckle, precision, layer, corner, length, 10, splice, path, alpha);
    self.postMessage({ svg });
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};
