// Approximate, opt-in geometry fitting; not Vectorizer's proprietary algorithm.
const KAPPA = 4 * (Math.sqrt(2) - 1) / 3;
const MAX_SAMPLES = 4096;
const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';

function checkedTolerance(tolerance) {
    if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError('tolerance must be positive and finite');
    return tolerance;
}

function bounds(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function signedArea(points) {
    // Local coordinates avoid cancellation for contours far from the origin.
    const origin = points[0];
    return points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + (p.x - origin.x) * (q.y - origin.y) - (q.x - origin.x) * (p.y - origin.y);
    }, 0) / 2;
}

function segmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy) || 0));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function distanceToContour(p, points) {
    let distance = Infinity;
    for (let i = 0; i < points.length; i++) {
        distance = Math.min(distance, segmentDistance(p, points[i], points[(i + 1) % points.length]));
    }
    return distance;
}

function simpleContour(points) {
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        for (let j = i + 2; j < points.length; j++) {
            if (i === 0 && j === points.length - 1) continue;
            const c = points[j], d = points[(j + 1) % points.length];
            if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
                Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
            if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return false;
        }
    }
    return true;
}

function fitContour(input, tolerance, box = null) {
    if (!Array.isArray(input) || input.length < 4 || input.length > MAX_SAMPLES ||
        input.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    const points = input.filter((p, i) => !i || p.x !== input[i - 1].x || p.y !== input[i - 1].y);
    if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
    if (points.length < 4) return null;
    box ??= bounds(points);
    const { x, y, width, height } = box;
    if (![x, y, width, height].every(Number.isFinite) || Math.min(width, height) < 4) return null;
    // A large requested tolerance must not turn small blobs into primitives.
    tolerance = Math.min(tolerance, Math.min(width, height) * 0.025);
    const area = signedArea(points), size = Math.abs(area);
    const perimeter = points.reduce((sum, p, i) => sum + Math.hypot(p.x - points[(i + 1) % points.length].x, p.y - points[(i + 1) % points.length].y), 0);
    if (!Number.isFinite(size + perimeter) || !size) return null;
    const corners = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    const rectDistance = p => Math.min(...corners.map((a, i) => segmentDistance(p, a, corners[(i + 1) % 4])));
    const cx = x + width / 2, cy = y + height / 2, rx = width / 2, ry = height / 2;
    const ellipseDistance = p => {
        const dx = p.x - cx, dy = p.y - cy;
        const radius = Math.hypot(dx / rx, dy / ry);
        return radius ? Math.abs(1 - 1 / radius) * Math.hypot(dx, dy) : Infinity;
    };
    const ellipsePerimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const candidates = [];
    for (const type of ['rectangle', 'ellipse']) {
        const expectedArea = type === 'rectangle' ? width * height : Math.PI * rx * ry;
        const expectedPerimeter = type === 'rectangle' ? 2 * (width + height) : ellipsePerimeter;
        const distance = type === 'rectangle' ? rectDistance : ellipseDistance;
        // Four kappa cubics have a small, nonzero radial error too.
        if (type === 'ellipse' && Math.max(rx, ry) * 0.000273 > tolerance / 4) continue;
        if (Math.abs(size / expectedArea - 1) > 0.015 || Math.abs(perimeter / expectedPerimeter - 1) > 0.03 ||
            points.some(p => distance(p) > tolerance)) continue;
        // Both directions matter: boundary proximity alone misses absent corners and notches.
        const target = [];
        if (type === 'rectangle') {
            for (let side = 0; side < 4; side++) {
                const a = corners[side], b = corners[(side + 1) % 4];
                const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / tolerance);
                if (steps > MAX_SAMPLES) return null;
                for (let i = 0; i < steps; i++) target.push({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
            }
        } else {
            const steps = Math.max(128, Math.ceil(2 * Math.PI * Math.max(rx, ry) / tolerance));
            if (steps > MAX_SAMPLES) return null;
            for (let i = 0; i < steps; i++) {
                const angle = 2 * Math.PI * i / steps;
                target.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
            }
        }
        if (target.every(p => distanceToContour(p, points) <= tolerance)) candidates.push(type);
    }
    if (candidates.length !== 1 || !simpleContour(points)) return null;
    return { type: candidates[0], box, clockwise: area > 0 };
}

/** Classify ordered, closed contour samples; closing point may be omitted. */
export function classifyContour(points, { tolerance = 0.6 } = {}) {
    return fitContour(points, checkedTolerance(tolerance))?.type ?? null;
}

function singleClosedSubpath(d) {
    const tokens = d.match(new RegExp(`${NUMBER}|[a-df-z]`, 'gi')) ?? [];
    if (d.replace(new RegExp(`${NUMBER}|[a-df-z]|[\\s,]`, 'gi'), '') || !/^[Mm]$/.test(tokens[0] ?? '') || !/^[Zz]$/.test(tokens.at(-1) ?? '')) return false;
    const arity = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
    for (let i = 0; i < tokens.length;) {
        const command = tokens[i++].toLowerCase();
        if (command === 'z') return i === tokens.length;
        if (!arity[command] || (command === 'm' && i !== 1)) return false;
        const start = i;
        while (i < tokens.length && Number.isFinite(Number(tokens[i]))) i++;
        if (i === start || (i - start) % arity[command]) return false;
        if (command === 'a') {
            for (let j = start; j < i; j += 7) {
                if (Number(tokens[j]) < 0 || Number(tokens[j + 1]) < 0 ||
                    !['0', '1'].includes(tokens[j + 3]) || !['0', '1'].includes(tokens[j + 4])) return false;
            }
        }
    }
    return false;
}

function translateOnly(node, view, svgRoot) {
    for (let parent = node; parent?.getAttribute; parent = parent.parentElement) {
        const transform = parent.getAttribute('transform')?.trim() ?? '';
        const translate = new RegExp(`translate\\(\\s*(${NUMBER})(?:[\\s,]+(${NUMBER}))?\\s*\\)`, 'g');
        if (transform.replace(translate, '').trim() || [...transform.matchAll(translate)].some(m => !Number.isFinite(Number(m[1])) || (m[2] && !Number.isFinite(Number(m[2]))))) return false;
        const style = view.getComputedStyle(parent);
        const css = style.transform;
        if (css && css !== 'none') {
            const values = css.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
            if (!values || values.length !== 6 || !values.every(Number.isFinite) || values[0] !== 1 || values[1] !== 0 || values[2] !== 0 || values[3] !== 1) return false;
        }
        if (style.translate && style.translate !== 'none') return false;
        if (style.rotate && style.rotate !== 'none') return false;
        if (style.scale && style.scale !== 'none') return false;
        if (parent === svgRoot) break;
    }
    return true;
}

function hasCssGeometry(path, view, style) {
    if (!style.d || style.d === 'none') return false;
    const original = path.getAttribute('d');
    // Presentation attributes participate in computed d too. Keep d present
    // while probing so selectors such as path[d] keep their CSS override.
    try {
        path.setAttribute('d', '');
        const d = view.getComputedStyle(path).d;
        return Boolean(d && d !== 'none');
    } finally {
        path.setAttribute('d', original);
    }
}

function primitivePath({ type, box: { x, y, width, height }, clockwise }) {
    const right = x + width, bottom = y + height;
    if (type === 'rectangle') {
        const corners = clockwise ? [[right, y], [right, bottom], [x, bottom]] : [[x, bottom], [right, bottom], [right, y]];
        return `M${x},${y} ${corners.map(p => `L${p.join(',')}`).join(' ')} Z`;
    }
    const rx = width / 2, ry = height / 2, cx = x + rx, cy = y + ry;
    const sign = clockwise ? 1 : -1;
    const point = (u, v) => `${cx + rx * u},${cy + ry * v * sign}`;
    return `M${point(1, 0)} C${point(1, KAPPA)} ${point(KAPPA, 1)} ${point(0, 1)} C${point(-KAPPA, 1)} ${point(-1, KAPPA)} ${point(-1, 0)} C${point(-1, -KAPPA)} ${point(-KAPPA, -1)} ${point(0, -1)} C${point(KAPPA, -1)} ${point(1, -KAPPA)} ${point(1, 0)} Z`;
}

/** Mutates only path d; preserves fill, transforms, attributes, and winding. */
export function optimizeGeometry(svgElement, { tolerance = 0.6 } = {}) {
    checkedTolerance(tolerance);
    if (!svgElement?.querySelectorAll) throw new TypeError('svgElement must be an SVG DOM element');
    const counts = { rectangles: 0, ellipses: 0, skipped: 0 };
    const view = svgElement.ownerDocument?.defaultView;
    for (const path of svgElement.querySelectorAll('path')) {
        let fit = null;
        try {
            const style = view?.getComputedStyle(path);
            if (!style || !style.fill || /none|url\(|var\(|context-|inherit|initial|unset/i.test(style.fill) ||
                style.stroke !== 'none' || ['markerStart', 'markerMid', 'markerEnd'].some(key => style[key] && style[key] !== 'none') ||
                path.hasAttribute('pathLength') || path.closest('defs, clipPath, mask, symbol, marker, pattern') ||
                !singleClosedSubpath(path.getAttribute('d') ?? '') || !translateOnly(path, view, svgElement) || hasCssGeometry(path, view, style)) {
                counts.skipped++;
                continue;
            }
            const box = path.getBBox();
            const length = path.getTotalLength();
            const spacing = Math.min(0.5, tolerance / 2, Math.min(box.width, box.height) / 32);
            const steps = Math.max(128, Math.ceil(length / spacing));
            // ponytail: bounded sampling skips huge paths; use adaptive subdivision for larger contours.
            if (length > 0 && Number.isFinite(length) && steps <= MAX_SAMPLES) {
                const points = Array.from({ length: steps }, (_, i) => path.getPointAtLength(length * i / steps));
                fit = fitContour(points, tolerance, box);
            }
            if (fit) {
                path.setAttribute('d', primitivePath(fit));
                counts[fit.type === 'rectangle' ? 'rectangles' : 'ellipses']++;
            } else counts.skipped++;
        } catch {
            // Detached, malformed, or unsupported geometry stays untouched.
            counts.skipped++;
        }
    }
    return counts;
}
