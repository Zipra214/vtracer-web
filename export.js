// VTracer export subset, not a general-purpose SVG interpreter.
const MAX_COMMANDS = 500000;
const MAX_COORD = 1e7;
const numberSource = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const numberToken = new RegExp(numberSource, 'y');
const fail = (message) => { throw new Error(message); };
const fmt = (n) => Number(n.toFixed(7)).toString();
function finite(n, name, min = -MAX_COORD, max = MAX_COORD) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) fail(`Invalid ${name}`);
  return n;
}
function tokens(text, commands = false) {
  const result = [];
  let i = 0, comma = false;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text[i] === ',') {
      if (comma || !result.length || typeof result.at(-1) === 'string') fail('Invalid comma');
      comma = true; i++; continue;
    }
    if (commands && /[a-zA-Z]/.test(text[i])) {
      if (comma) fail('Invalid comma');
      result.push(text[i++]);
    } else {
      numberToken.lastIndex = i;
      const match = numberToken.exec(text);
      if (!match) fail(`Invalid numeric syntax at ${i}`);
      result.push(finite(Number(match[0]), 'coordinate'));
      i = numberToken.lastIndex;
    }
    comma = false;
    if (result.length > MAX_COMMANDS * 7) fail('Path too large');
  }
  if (comma) fail('Invalid trailing comma');
  return result;
}

/** Absolute M/L/C/Q/Z command arrays. H/V/S/T and relative commands normalized. Arcs rejected. */
export function parsePath(d) {
  if (typeof d !== 'string' || d.length > 20000000) fail('Invalid path data');
  const input = tokens(d, true), output = [];
  let i = 0, command, x = 0, y = 0, sx = 0, sy = 0, cubic, quadratic;
  const counts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 };
  while (i < input.length) {
    if (typeof input[i] === 'string') command = input[i++];
    else if (!command) fail('Expected path command');
    const kind = command.toUpperCase(), relative = command !== kind;
    if (!output.length && kind !== 'M') fail('Path must start with M');
    if (kind === 'Z') {
      output.push(['Z']); x = sx; y = sy; cubic = quadratic = undefined; command = undefined;
      if (output.length > MAX_COMMANDS) fail('Too many path commands');
      continue;
    }
    const count = counts[kind];
    if (!count) fail(`Unsupported path command ${command}`);
    const values = input.slice(i, i + count);
    if (values.length !== count || values.some((n) => typeof n !== 'number')) fail(`Missing arguments for ${command}`);
    i += count;
    if (relative) {
      for (let j = 0; j < count; j++) values[j] += kind === 'V' ? y : kind === 'H' ? x : j % 2 ? y : x;
    }
    let next;
    switch (kind) {
      case 'M': next = ['M', ...values]; [sx, sy] = values; command = relative ? 'l' : 'L'; break;
      case 'L': next = ['L', ...values]; break;
      case 'H': next = ['L', values[0], y]; break;
      case 'V': next = ['L', x, values[0]]; break;
      case 'C': next = ['C', ...values]; break;
      case 'S': next = ['C', ...(cubic ? [2 * x - cubic[0], 2 * y - cubic[1]] : [x, y]), ...values]; break;
      case 'Q': next = ['Q', ...values]; break;
      case 'T': next = ['Q', ...(quadratic ? [2 * x - quadratic[0], 2 * y - quadratic[1]] : [x, y]), ...values]; break;
    }
    for (const n of next.slice(1)) finite(n, 'normalized coordinate');
    cubic = next[0] === 'C' ? next.slice(3, 5) : undefined;
    quadratic = next[0] === 'Q' ? next.slice(1, 3) : undefined;
    [x, y] = next.slice(-2);
    output.push(next);
    if (output.length > MAX_COMMANDS) fail('Too many path commands');
  }
  return output;
}

function translate(value) {
  if (!value?.trim()) return [0, 0];
  let x = 0, y = 0, rest = value.trim();
  while (rest) {
    const match = /^translate\s*\(([^()]*)\)/.exec(rest);
    if (!match) fail('Only translate transforms supported');
    const n = tokens(match[1]);
    if (n.length < 1 || n.length > 2) fail('Invalid translate');
    x += n[0]; y += n[1] || 0;
    rest = rest.slice(match[0].length).trim();
    if (rest.startsWith(',')) rest = rest.slice(1).trim() || fail('Invalid transform separator');
  }
  return [finite(x, 'translation'), finite(y, 'translation')];
}
function color(value) {
  if (value === 'none') return null;
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) fail(`Unsupported fill ${value}`);
  const hex = value.length === 4 ? [...value.slice(1)].map((c) => c + c).join('') : value.slice(1);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function attrNumber(el, name, fallback, min = -MAX_COORD) {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  if (!new RegExp(`^${numberSource}$`).test(raw.trim())) fail(`Invalid ${name}`);
  return finite(Number(raw), name, min);
}
function shapePath(el) {
  const n = (name, fallback = 0, min) => attrNumber(el, name, fallback, min);
  if (el.localName === 'path') return parsePath(el.getAttribute('d') || '');
  if (el.localName === 'rect') {
    if (n('rx', 0, 0) || n('ry', 0, 0)) fail('Rounded rectangles unsupported');
    const x = n('x'), y = n('y'), w = n('width', 0, 0), h = n('height', 0, 0);
    return w && h ? [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']] : [];
  }
  const x = n('cx'), y = n('cy');
  const rx = n(el.localName === 'circle' ? 'r' : 'rx', 0, 0);
  const ry = el.localName === 'circle' ? rx : n('ry', 0, 0);
  if (!rx || !ry) return [];
  // ponytail: four cubic ellipse approximation (max radial error ~0.028%); SVG/PDF/PNG retain exact primitives.
  const k = 0.5522847498307936;
  return [['M', x + rx, y], ['C', x + rx, y + k * ry, x + k * rx, y + ry, x, y + ry],
    ['C', x - k * rx, y + ry, x - rx, y + k * ry, x - rx, y],
    ['C', x - rx, y - k * ry, x - k * rx, y - ry, x, y - ry],
    ['C', x + k * rx, y - ry, x + rx, y - k * ry, x + rx, y], ['Z']];
}

function readSvg(text) {
  if (typeof text !== 'string' || text.length > 20000000 || /<!DOCTYPE|<!ENTITY/i.test(text)) fail('Invalid SVG source');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) fail('Malformed SVG');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') fail('Expected SVG document');
  const vb = tokens(root.getAttribute('viewBox') || '');
  if (vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0) fail('Valid viewBox required');
  const paths = [];
  let commandCount = 0;
  const presentation = ['fill', 'opacity', 'fill-opacity', 'fill-rule', 'stroke'];
  const common = ['id', 'transform', 'style', ...presentation];
  const allowed = {
    svg: [...common, 'xmlns', 'version', 'viewBox', 'width', 'height', 'preserveAspectRatio'],
    g: common, path: [...common, 'd'], rect: [...common, 'x', 'y', 'width', 'height', 'rx', 'ry'],
    circle: [...common, 'cx', 'cy', 'r'], ellipse: [...common, 'cx', 'cy', 'rx', 'ry'],
    title: ['id'], desc: ['id'],
  };
  function visit(el, inherited, offset, depth) {
    if (depth > 64) fail('SVG nesting too deep');
    if (el.namespaceURI !== root.namespaceURI || !Object.hasOwn(allowed, el.localName) || (el !== root && el.localName === 'svg')) fail(`Unsupported SVG element ${el.localName}`);
    for (const attr of el.attributes) {
      if (!allowed[el.localName].includes(attr.name) && !/^data-[\w-]+$/.test(attr.name)) fail(`Unsupported SVG attribute ${attr.name}`);
    }
    if (['title', 'desc'].includes(el.localName)) {
      if (el.children.length) fail('Nested metadata elements unsupported');
      return;
    }
    const styles = {};
    for (const key of presentation) if (el.hasAttribute(key)) styles[key] = el.getAttribute(key).trim();
    for (const declaration of (el.getAttribute('style') || '').split(';')) {
      if (!declaration.trim()) continue;
      const pair = declaration.split(':');
      if (pair.length !== 2 || !presentation.includes(pair[0].trim())) fail('Unsupported inline SVG style');
      styles[pair[0].trim()] = pair[1].trim();
    }
    const state = { ...inherited, ...styles };
    // opacity is not inherited; group alpha requires isolated-group compositing.
    state.opacity = styles.opacity ?? '1';
    for (const key of ['opacity', 'fill-opacity']) {
      if (!new RegExp(`^${numberSource}$`).test(state[key])) fail(`Invalid ${key}`);
      finite(Number(state[key]), key, 0, 1);
    }
    color(state.fill);
    if (state.stroke !== 'none') fail('Strokes unsupported');
    if (!['nonzero', 'evenodd'].includes(state['fill-rule'])) fail('Unsupported fill rule');
    const [tx, ty] = translate(el.getAttribute('transform'));
    const nextOffset = [finite(offset[0] + tx, 'translation'), finite(offset[1] + ty, 'translation')];
    if (['svg', 'g'].includes(el.localName)) {
      if (Number(state.opacity) !== 1) fail('Group opacity unsupported');
    } else if (!['title', 'desc'].includes(el.localName)) {
      if (el.children.length) fail('Nested shape elements unsupported');
      const commands = shapePath(el).map(([kind, ...values]) => [kind, ...values.map((v, i) => finite(v + nextOffset[i % 2], 'transformed coordinate'))]);
      commandCount += commands.length;
      if (commandCount > MAX_COMMANDS) fail('Too many SVG commands');
      if (commands.length && state.fill !== 'none') paths.push({ commands, rgb: color(state.fill), alpha: Number(state.opacity) * Number(state['fill-opacity']), rule: state['fill-rule'], primitive: el.localName !== 'path' && el.localName !== 'rect' });
    }
    for (const child of el.children) visit(child, state, nextOffset, depth + 1);
  }
  visit(root, { fill: '#000000', opacity: '1', 'fill-opacity': '1', 'fill-rule': 'nonzero', stroke: 'none' }, [0, 0], 0);
  if (!paths.length) fail('SVG contains no filled geometry');
  return { root, vb, paths };
}

function pageSize(vb, widthMm, heightMm) {
  if (widthMm === undefined && heightMm === undefined) widthMm = vb[2] * 25.4 / 96;
  if (widthMm === undefined) widthMm = heightMm * vb[2] / vb[3];
  if (heightMm === undefined) heightMm = widthMm * vb[3] / vb[2];
  finite(widthMm, 'widthMm', 0.01, 10000); finite(heightMm, 'heightMm', 0.01, 10000);
  return [widthMm, heightMm];
}
function mapping(vb, width, height) {
  const scale = Math.min(width / vb[2], height / vb[3]);
  return { scale, point: (x, y) => [(width - vb[2] * scale) / 2 + (x - vb[0]) * scale, (height - vb[3] * scale) / 2 + (y - vb[1]) * scale] };
}
function eps(paths, vb, widthMm, heightMm) {
  const width = widthMm * 72 / 25.4, height = heightMm * 72 / 25.4;
  const map = mapping(vb, width, height);
  const lines = ['%!PS-Adobe-3.0 EPSF-3.0', `%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}`,
    `%%HiResBoundingBox: 0 0 ${fmt(width)} ${fmt(height)}`, '%%LanguageLevel: 2',
    '%%Transparency: partial alpha composited per fill over white; no EPS alpha', '%%EndComments', 'gsave',
    `0 0 ${fmt(width)} ${fmt(height)} rectclip`];
  const point = (x, y) => { const p = map.point(x, y); return `${fmt(p[0])} ${fmt(height - p[1])}`; };
  for (const path of paths) {
    if (!path.alpha) continue;
    lines.push(path.rgb.map((c) => fmt((c * path.alpha + 255 * (1 - path.alpha)) / 255)).join(' ') + ' setrgbcolor', 'newpath');
    let x = 0, y = 0, sx = 0, sy = 0;
    for (const [kind, ...v] of path.commands) {
      if (kind === 'M') { lines.push(`${point(...v)} moveto`); [sx, sy] = v; }
      if (kind === 'L') lines.push(`${point(...v)} lineto`);
      if (kind === 'C') lines.push(`${point(v[0], v[1])} ${point(v[2], v[3])} ${point(v[4], v[5])} curveto`);
      if (kind === 'Q') lines.push(`${point(x + 2 / 3 * (v[0] - x), y + 2 / 3 * (v[1] - y))} ${point(v[2] + 2 / 3 * (v[0] - v[2]), v[3] + 2 / 3 * (v[1] - v[3]))} ${point(v[2], v[3])} curveto`);
      if (kind === 'Z') { lines.push('closepath'); x = sx; y = sy; } else [x, y] = v.slice(-2);
    }
    lines.push(path.rule === 'evenodd' ? 'eofill' : 'fill');
  }
  lines.push('grestore', 'showpage', '%%EOF');
  return lines.join('\n') + '\n';
}

function flatten(commands, map, tolerance) {
  const paths = [];
  let current, point, start, vertices = 0;
  const add = (p) => { if (++vertices > MAX_COMMANDS) fail('DXF vertex limit exceeded'); current.points.push(p); };
  const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  function distance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function curve(points, depth = 0) {
    const a = points[0], b = points.at(-1);
    if (points.slice(1, -1).every((p) => distance(p, a, b) <= tolerance)) { add(b); return; }
    if (depth >= 20) fail('DXF tolerance cannot be met within subdivision limit');
    const left = [a], right = [b];
    let level = points;
    while (level.length > 1) {
      level = level.slice(0, -1).map((p, i) => midpoint(p, level[i + 1]));
      left.push(level[0]); right.unshift(level.at(-1));
    }
    curve(left, depth + 1); curve(right, depth + 1);
  }
  for (const [kind, ...v] of commands) {
    if (kind === 'M') { point = map.point(...v); start = point; current = { points: [], closed: false }; paths.push(current); add(point); }
    else if (kind === 'Z') { current.closed = true; point = start; }
    else {
      // Drawing after Z starts a fresh subpath at its closed subpath's start.
      if (current.closed) { current = { points: [], closed: false }; paths.push(current); add(point); }
      const end = map.point(...v.slice(-2));
      if (kind === 'L') add(end);
      else curve([point, ...Array.from({ length: v.length / 2 }, (_, i) => map.point(v[i * 2], v[i * 2 + 1]))]);
      point = end;
    }
  }
  return paths;
}
function dxf(paths, vb, width, height, tolerance) {
  const lines = [], pair = (code, value) => lines.push(String(code), String(value));
  pair(999, 'VTracer DXF R12: coordinates in millimeters; outlines only, no fills or transparency; nearest basic ACI colors.');
  pair(999, `Bezier flattening tolerance ${fmt(tolerance)} mm; geometry outside viewBox is not clipped.`);
  pair(0, 'SECTION'); pair(2, 'HEADER'); pair(9, '$ACADVER'); pair(1, 'AC1009');
  pair(0, 'ENDSEC'); pair(0, 'SECTION'); pair(2, 'ENTITIES');
  const map = mapping(vb, width, height);
  const palette = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [0, 0, 0], [128, 128, 128], [192, 192, 192]];
  let total = 0;
  for (const path of paths) {
    if (!path.alpha) continue;
    const distances = palette.map((rgb) => rgb.reduce((sum, c, i) => sum + (c - path.rgb[i]) ** 2, 0));
    const aci = distances.indexOf(Math.min(...distances)) + 1;
    for (const polygon of flatten(path.commands, map, tolerance)) {
      total += polygon.points.length;
      if (total > MAX_COMMANDS) fail('DXF vertex limit exceeded');
      if (polygon.points.length < 2) continue;
      pair(0, 'POLYLINE'); pair(8, '0'); pair(62, aci); pair(66, 1); pair(10, 0); pair(20, 0); pair(30, 0); pair(70, polygon.closed ? 1 : 0);
      for (const [x, y] of polygon.points) {
        pair(0, 'VERTEX'); pair(8, '0'); pair(10, fmt(x)); pair(20, fmt(height - y)); pair(30, 0);
      }
      pair(0, 'SEQEND'); pair(8, '0');
    }
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF');
  return lines.join('\r\n') + '\r\n';
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function pngDpi(blob, resolution) {
  const input = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(input.buffer);
  if (input.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) fail('Invalid encoded PNG');
  const chunk = new Uint8Array(21), data = new DataView(chunk.buffer);
  data.setUint32(0, 9); data.setUint32(4, 0x70485973); // pHYs
  const pixelsPerMeter = Math.round(resolution / 0.0254);
  data.setUint32(8, pixelsPerMeter); data.setUint32(12, pixelsPerMeter); chunk[16] = 1;
  data.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [input.subarray(0, 33), chunk];
  let offset = 33, ended = false;
  while (offset < input.length) {
    if (offset + 12 > input.length) fail('Truncated encoded PNG');
    const length = view.getUint32(offset), end = offset + length + 12, type = view.getUint32(offset + 4);
    if (end > input.length) fail('Truncated encoded PNG chunk');
    if (type !== 0x70485973) parts.push(input.subarray(offset, end));
    offset = end;
    if (type === 0x49454e44) { ended = true; break; }
  }
  if (!ended || offset !== input.length) fail('Invalid PNG end');
  return new Blob(parts, { type: 'image/png' });
}

async function png(root, widthMm, heightMm, resolution) {
  finite(resolution, 'resolution (DPI)', 1, 2400);
  const width = Math.max(1, Math.round(widthMm / 25.4 * resolution));
  const height = Math.max(1, Math.round(heightMm / 25.4 * resolution));
  if (width > 10000 || height > 10000 || width * height > 16000000) fail('PNG exceeds 16 million pixels or 10000 pixels per side');
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
  const image = new Image(), url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) fail('Canvas unavailable');
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
    return await pngDpi(blob, resolution);
  } finally { URL.revokeObjectURL(url); }
}

/** resolution is PNG DPI; toleranceMm is DXF maximum curve/chord deviation. */
export async function exportVector(svgText, format, { widthMm, heightMm, resolution = 96, toleranceMm = 0.05 } = {}) {
  if (!['svg', 'pdf', 'eps', 'dxf', 'png'].includes(format)) fail('Unsupported export format');
  const { root, vb, paths } = readSvg(svgText);
  [widthMm, heightMm] = pageSize(vb, widthMm, heightMm);
  root.setAttribute('width', `${fmt(widthMm)}mm`); root.setAttribute('height', `${fmt(heightMm)}mm`);
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const warnings = [];
  if (format === 'svg') return { blob: new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }), extension: 'svg', warnings };
  if (format === 'png') return { blob: await png(root, widthMm, heightMm, resolution), extension: 'png', warnings };
  if (format === 'pdf') {
    if (widthMm > 5080 || heightMm > 5080) fail('PDF exceeds 5080 mm per side');
    const { jsPDF, svg2pdf } = await import('./vendor/pdf.js');
    const pdf = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation: widthMm > heightMm ? 'landscape' : 'portrait', compress: true });
    if (typeof svg2pdf === 'function') await svg2pdf(root, pdf, { x: 0, y: 0, width: widthMm, height: heightMm });
    else if (typeof pdf.svg === 'function') await pdf.svg(root, { x: 0, y: 0, width: widthMm, height: heightMm });
    else fail('Vector PDF renderer unavailable');
    return { blob: pdf.output('blob'), extension: 'pdf', warnings };
  }
  if (paths.some((p) => p.primitive)) warnings.push('EPS/DXF ellipses and circles use four cubic Beziers (maximum radial error approximately 0.028%).');
  if (format === 'eps') {
    if (paths.some((p) => p.alpha > 0 && p.alpha < 1)) warnings.push('EPS has no alpha: each translucent fill is composited over white, not overlapping artwork.');
    return { blob: new Blob([eps(paths, vb, widthMm, heightMm)], { type: 'application/postscript' }), extension: 'eps', warnings };
  }
  finite(toleranceMm, 'toleranceMm', 0.001, 1);
  warnings.push('DXF R12 contains outlines only, no fills or transparency; colors use nearest basic ACI palette. Coordinates are millimeters; geometry outside viewBox is not clipped.');
  return { blob: new Blob([dxf(paths, vb, widthMm, heightMm, toleranceMm)], { type: 'application/dxf' }), extension: 'dxf', warnings };
}
