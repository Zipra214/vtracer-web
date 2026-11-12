export const presets = {
  don_gian: { filter_speckle: 8, color_precision: 4, layer_difference: 32, corner_threshold: 85, length_threshold: 1, splice_threshold: 30, path_precision: 5, max_iterations: 20 },
  can_bang: { filter_speckle: 4, color_precision: 6, layer_difference: 16, corner_threshold: 85, length_threshold: 1, splice_threshold: 30, path_precision: 5, max_iterations: 20 },
  chi_tiet: { filter_speckle: 2, color_precision: 8, layer_difference: 8, corner_threshold: 85, length_threshold: 1, splice_threshold: 30, path_precision: 5, max_iterations: 20 },
};
export const fields = {
  filter_speckle: ['adv-speckle', 0, 100], color_precision: ['adv-precision', 1, 8],
  layer_difference: ['adv-layer', 0, 255], corner_threshold: ['adv-corner', 0, 180],
  path_precision: ['adv-path', -1, 8], length_threshold: ['adv-length', .1, 20],
  splice_threshold: ['adv-splice', 0, 180], max_iterations: ['adv-iterations', 1, 20],
};
export function validateParams(params) {
  const result = {};
  if (!params || typeof params !== 'object') throw new Error('Thiếu thông số vector.');
  for (const [key, [, min, max]] of Object.entries(fields)) {
    const raw = params[key];
    const n = typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < min || n > max || key !== 'length_threshold' && !Number.isInteger(n)) {
      throw new Error(`${key} phải trong khoảng ${min} đến ${max}${key === 'length_threshold' ? '' : ', số nguyên'}.`);
    }
    result[key] = n;
  }
  return result;
}
