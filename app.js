const $ = (id) => document.getElementById(id);
const descriptions = {
  don_gian: 'Khối màu lớn, ít path, phù hợp in ấn và cắt decal.',
  can_bang: 'Cân bằng giữa chi tiết và số lượng vector path.',
  chi_tiet: 'Giữ đường nét nhỏ và dải màu mịn; nhiều path và xử lý lâu hơn.',
};
let inputUrl, outputUrl, filename = 'vector', worker, timer;
let loading = false;
let loadId = 0;
let ready = false;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}

function controls() {
  $('file').disabled = loading || Boolean(worker);
  $('options').disabled = loading || Boolean(worker);
  $('convert').disabled = !ready || loading || Boolean(worker);
  $('cancel').hidden = !worker;
  $('previews').setAttribute('aria-busy', String(loading || Boolean(worker)));
}

function clearResult() {
  $('download').hidden = true;
  $('download').removeAttribute('href');
  $('result').hidden = true;
  $('result').removeAttribute('src');
  $('result-empty').hidden = false;
  $('result-size').textContent = '';
  $('stats').textContent = 'Đầu ra SVG thuần path, không nhúng ảnh raster.';
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
}

function stopWorker() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
  controls();
}

function checkDimensions(width, height) {
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000 || width * height > 16000000) {
    throw new Error('Ảnh tối đa 10.000 pixel mỗi chiều và 16 triệu pixel tổng cộng.');
  }
}

function imageDimensions(buffer) {
  const view = new DataView(buffer);
  const size = view.byteLength;
  const malformed = () => { throw new Error('Header ảnh hỏng, bị cắt ngắn hoặc không được hỗ trợ.'); };
  const need = (offset, length) => { if (offset + length > size) malformed(); };
  need(0, 2);
  let width, height;
  if (view.getUint16(0) === 0x8950) {
    need(0, 33);
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
        view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) malformed();
    width = view.getUint32(16);
    height = view.getUint32(20);
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[view.getUint8(25)]?.includes(view.getUint8(24)) ||
        view.getUint8(26) || view.getUint8(27) || view.getUint8(28) > 1) malformed();
  } else if (view.getUint16(0) === 0xffd8) {
    // File size is capped at 20 MiB before this scan; every segment advances within it.
    let offset = 2;
    while (offset < size) {
      if (view.getUint8(offset++) !== 0xff) malformed();
      while (offset < size && view.getUint8(offset) === 0xff) offset++;
      need(offset, 1);
      const marker = view.getUint8(offset++);
      if (marker === 0x01) continue;
      if (!marker || marker === 0xd8 || marker === 0xd9 || marker === 0xda ||
          (marker >= 0xd0 && marker <= 0xd7)) malformed();
      need(offset, 2);
      const length = view.getUint16(offset);
      if (length < 2) malformed();
      need(offset, length);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8 || !view.getUint8(offset + 7) || length !== 8 + 3 * view.getUint8(offset + 7)) malformed();
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
    if (width === undefined) malformed();
  } else if (view.getUint16(0) === 0x5249) {
    need(0, 20);
    const end = view.getUint32(4, true) + 8;
    if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250 ||
        end < 20 || end > size) malformed();
    const chunk = view.getUint32(12), length = view.getUint32(16, true);
    if (20 + length + (length & 1) > end) malformed();
    need(20, length + (length & 1));
    if (chunk === 0x56503820) { // VP8 key frame
      if (length < 10 || (view.getUint8(20) & 1) || view.getUint8(23) !== 0x9d ||
          view.getUint16(24) !== 0x012a) malformed();
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 0x5650384c) { // VP8L
      if (length < 5 || view.getUint8(20) !== 0x2f) malformed();
      const bits = view.getUint32(21, true);
      if (bits >>> 29) malformed();
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunk === 0x56503858) { // VP8X canvas, including animated WebP
      if (length !== 10 || (view.getUint32(20, true) & 0xffffffc1)) malformed();
      const uint24 = (offset) => view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
      width = uint24(24) + 1;
      height = uint24(27) + 1;
    } else malformed();
  } else if (view.getUint16(0) === 0x424d) {
    need(0, 18);
    const dib = view.getUint32(14, true);
    if (![12, 16, 40, 52, 56, 64, 108, 124].includes(dib)) malformed();
    need(14, dib);
    const pixels = view.getUint32(10, true);
    if (pixels < 14 + dib || pixels >= size) malformed();
    if (dib === 12) {
      width = view.getUint16(18, true);
      height = view.getUint16(20, true);
      if (view.getUint16(22, true) !== 1) malformed();
    } else {
      const os2 = dib === 16 || dib === 64;
      width = os2 ? view.getUint32(18, true) : view.getInt32(18, true);
      height = os2 ? view.getUint32(22, true) : Math.abs(view.getInt32(22, true));
      if (view.getUint16(26, true) !== 1) malformed();
    }
  } else {
    throw new Error('Chỉ nhận file có chữ ký PNG, JPEG, WebP hoặc BMP; không nhận SVG hay GIF.');
  }
  checkDimensions(width, height);
  return [width, height];
}

async function loadFile(file) {
  if (!file || worker) return;
  const id = ++loadId;
  loading = true;
  ready = false;
  clearResult();
  $('source').hidden = true;
  $('source').removeAttribute('src');
  $('source-empty').hidden = false;
  $('source-size').textContent = '';
  $('file-info').textContent = 'Đang đọc ảnh…';
  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = undefined;
  controls();
  let url;
  try {
    if (!(file instanceof Blob) || !file.size || file.size > 20 * 1024 * 1024) {
      throw new Error('Ảnh phải lớn hơn 0 byte và không quá 20 MB.');
    }
    imageDimensions(await file.arrayBuffer());
    if (id !== loadId) return;
    url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    await image.decode();
    if (id !== loadId) return;
    const width = image.naturalWidth, height = image.naturalHeight;
    checkDimensions(width, height);
    inputUrl = url;
    url = undefined;
    filename = (file.name || 'clipboard').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'vector';
    $('source').src = inputUrl;
    await $('source').decode();
    if (id !== loadId) return;
    $('source').hidden = false;
    $('source-empty').hidden = true;
    $('source-size').textContent = `${width} × ${height}`;
    $('file-info').textContent = `${file.name || 'Ảnh clipboard'} · ${(file.size / 1024).toFixed(0)} KB`;
    ready = true;
    status('Ảnh sẵn sàng. Chọn thiết lập rồi chuyển thành SVG.');
  } catch (error) {
    if (id !== loadId) return;
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    inputUrl = undefined;
    $('source').removeAttribute('src');
    $('file-info').textContent = 'Chưa có ảnh hợp lệ.';
    status(error instanceof Error && error.name !== 'EncodingError' ? error.message : 'Không đọc được ảnh. File hỏng hoặc định dạng không hỗ trợ.', true);
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (id === loadId) { loading = false; controls(); }
  }
}

$('file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  loadFile(file);
});
for (const name of ['dragenter', 'dragover']) {
  $('drop').addEventListener(name, (event) => {
    event.preventDefault();
    if (!worker && !loading) $('drop').classList.add('dragover');
  });
}
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('dragover'));
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop').classList.remove('dragover');
  if (!loading) loadFile(event.dataTransfer?.files[0]);
});
window.addEventListener('paste', (event) => {
  if (event.target.closest('input:not([type=file]), textarea, select, [contenteditable]')) return;
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.kind === 'file');
  if (item && !worker && !loading) { event.preventDefault(); loadFile(item.getAsFile()); }
});
$('options').addEventListener('change', () => {
  $('preset-info').textContent = descriptions[$('preset').value];
  clearResult();
  if (ready) status('Thiết lập đã đổi. Chuyển lại để cập nhật SVG.');
});
$('cancel').addEventListener('click', () => {
  stopWorker();
  status('Đã hủy. Ảnh gốc vẫn giữ nguyên.');
});
$('convert').addEventListener('click', () => {
  if (!ready || loading || worker) return;
  clearResult();
  const started = performance.now();
  try {
    const source = $('source');
    const width = source.naturalWidth, height = source.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
    context.drawImage(source, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data.buffer;
    canvas.width = canvas.height = 0;
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    controls();
    status('Đang vector hóa trên thiết bị… Bạn có thể hủy xử lý.');
    worker.onmessage = ({ data }) => {
      stopWorker();
      if (data.error || typeof data.svg !== 'string') {
        status(data.error || 'Kết quả xử lý không hợp lệ.', true);
        return;
      }
      const blob = new Blob([data.svg], { type: 'image/svg+xml' });
      outputUrl = URL.createObjectURL(blob);
      $('result').src = outputUrl;
      $('result').hidden = false;
      $('result-empty').hidden = true;
      $('result-size').textContent = `${(blob.size / 1024).toFixed(1)} KB`;
      const paths = (data.svg.match(/<path\b/g) || []).length;
      $('stats').textContent = `${paths.toLocaleString('vi-VN')} path · ${((performance.now() - started) / 1000).toFixed(2)} giây`;
      $('download').href = outputUrl;
      $('download').download = `${filename}.svg`;
      $('download').hidden = false;
      status(paths ? 'Hoàn tất. SVG sẵn sàng tải xuống.' : 'SVG trống: ảnh trong suốt hoặc chi tiết nhỏ đã bị lọc. Thử Giữ chi tiết cao.');
    };
    worker.onerror = (event) => {
      event.preventDefault();
      stopWorker();
      status('Không chạy được WASM hoặc hết bộ nhớ. Thử ảnh nhỏ hơn hoặc tải lại trang.', true);
    };
    timer = setTimeout(() => {
      stopWorker();
      status('Đã dừng sau 120 giây. Thử ảnh nhỏ hơn hoặc preset Ít nét.', true);
    }, 120000);
    worker.postMessage({ rgba, width, height, preset: $('preset').value,
      alpha: document.querySelector('input[name=alpha]:checked').value }, [rgba]);
  } catch (error) {
    stopWorker();
    status(`Không chuyển đổi được: ${error.message}`, true);
  }
});
window.addEventListener('pagehide', () => {
  const busy = loading || Boolean(worker);
  if (loading) {
    ++loadId;
    loading = false;
    $('source').removeAttribute('src');
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    inputUrl = undefined;
    $('file-info').textContent = 'Chưa có ảnh hợp lệ.';
  }
  stopWorker();
  if (busy) status(ready ? 'Đã hủy. Ảnh gốc vẫn giữ nguyên.' : 'Đã dừng đọc ảnh. Chọn lại ảnh để tiếp tục.');
});

