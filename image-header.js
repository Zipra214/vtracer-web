export function checkDimensions(width, height) {
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000 || width * height > 16000000) {
    throw new Error('Ảnh tối đa 10.000 pixel mỗi chiều và 16 triệu pixel tổng cộng.');
  }
}

export function imageDimensions(buffer) {
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

