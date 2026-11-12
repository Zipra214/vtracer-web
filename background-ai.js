// U2NetP is a 320×320 salient-object model, not a portrait-specific matte model.
// Weights: rembg v0.0.0/u2netp.onnx; U2Net license: Apache-2.0.
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function checkSize(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) {
        throw new RangeError('Image dimensions must be positive safe integers');
    }
}

function checkRGBA(rgba) {
    if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length % 4) {
        throw new TypeError('Expected RGBA bytes');
    }
}

// Bilinear, pixel-center sampling. Channels are returned in planar order.
// RGB is sampled separately from alpha, avoiding premultiplication/dark fringes.
function resizeSamples(source, width, height, targetWidth, targetHeight, channels, stride) {
    const plane = targetWidth * targetHeight;
    const result = new Float32Array(plane * channels);
    for (let y = 0; y < targetHeight; y++) {
        const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / targetHeight - 0.5));
        const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, height - 1), fy = sy - y0;
        for (let x = 0; x < targetWidth; x++) {
            const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / targetWidth - 0.5));
            const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, width - 1), fx = sx - x0;
            for (let c = 0; c < channels; c++) {
                const top = source[(y0 * width + x0) * stride + c] * (1 - fx) +
                    source[(y0 * width + x1) * stride + c] * fx;
                const bottom = source[(y1 * width + x0) * stride + c] * (1 - fx) +
                    source[(y1 * width + x1) * stride + c] * fx;
                result[c * plane + y * targetWidth + x] = top * (1 - fy) + bottom * fy;
            }
        }
    }
    return result;
}

/** RGBA bytes -> float32 RGB NCHW [1,3,320,320]; alpha never affects RGB. */
export function preprocessRGBA(rgba, width, height) {
    checkSize(width, height);
    checkRGBA(rgba);
    if (rgba.length !== width * height * 4) throw new RangeError('RGBA size mismatch');
    const data = resizeSamples(rgba, width, height, SIZE, SIZE, 3, 4);
    let maximum = 0;
    for (const value of data) maximum = Math.max(maximum, value);
    // Official rembg divides RGB by its image-wide maximum, not fixed 255.
    // Black images use 1 so normalization stays finite.
    const divisor = maximum || 1;
    const plane = SIZE * SIZE;
    for (let c = 0; c < 3; c++) {
        for (let i = c * plane; i < (c + 1) * plane; i++) {
            data[i] = (data[i] / divisor - MEAN[c]) / STD[c];
        }
    }
    return data;
}

/** Min/max saliency normalization; uniform maps retain clamped probability. */
export function normalizeMask(values) {
    if (!values || !Number.isSafeInteger(values.length) || values.length < 1) {
        throw new RangeError('Mask must not be empty');
    }
    let minimum = Infinity, maximum = -Infinity;
    for (const value of values) {
        if (!Number.isFinite(value)) throw new TypeError('Mask values must be finite');
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
    }
    const range = maximum - minimum;
    return Float32Array.from(values, value => Math.max(0, Math.min(1,
        range === 0 ? value : (value - minimum) / range)));
}

/** Resize a single-channel mask, preserving values at clamped image edges. */
export function resizeMask(mask, width, height, targetWidth, targetHeight) {
    checkSize(width, height);
    checkSize(targetWidth, targetHeight);
    if (mask.length !== width * height) throw new RangeError('Mask size mismatch');
    for (const value of mask) {
        if (!Number.isFinite(value)) throw new TypeError('Mask values must be finite');
    }
    return resizeSamples(mask, width, height, targetWidth, targetHeight, 1, 1);
}

/** Copy RGB exactly; multiply existing alpha by full-size saliency. No mutation. */
export function applyMaskToRGBA(rgba, mask) {
    checkRGBA(rgba);
    if (mask.length * 4 !== rgba.length) throw new RangeError('Mask size mismatch');
    const result = new Uint8ClampedArray(rgba);
    for (let i = 0; i < mask.length; i++) {
        if (!Number.isFinite(mask[i])) throw new TypeError('Mask values must be finite');
        result[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * Math.max(0, Math.min(1, mask[i])));
    }
    return result;
}

function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Operation aborted', 'AbortError');
}

/**
 * Return a new full-size canvas; input remains unchanged.
 * onProgress({stage, progress}) uses progress 0..1, not download byte progress.
 * Works in a module Worker with OffscreenCanvas. Caller owns worker/generation guards.
 * Abort is checked between stages; it does not interrupt an active ORT inference.
 */
export async function removeBackgroundAI(canvas, { signal, onProgress } = {}) {
    checkAbort(signal);
    const { width, height } = canvas;
    checkSize(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('A 2D canvas context is required');
    // Snapshot before asynchronous loading, so caller edits cannot change this run.
    const original = context.getImageData(0, 0, width, height);
    const progress = (stage, value) => {
        checkAbort(signal);
        onProgress?.({ stage, progress: value });
        checkAbort(signal);
    };
    progress('loading', 0);
    const ort = await import('./vendor/ort/ort.min.mjs');
    checkAbort(signal);
    ort.env.wasm.wasmPaths = {
        mjs: new URL('./vendor/ort/ort-wasm-simd-threaded.mjs', import.meta.url).href,
        wasm: new URL('./vendor/ort/ort-wasm-simd-threaded.wasm', import.meta.url).href,
    };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    let session, input, output;
    try {
        session = await ort.InferenceSession.create(
            new URL('./models/u2netp.onnx', import.meta.url).href,
            { executionProviders: ['wasm'] },
        );
        progress('preprocessing', 0.25);
        const inputName = session.inputNames[0], outputName = session.outputNames[0];
        if (!inputName || !outputName) throw new Error('Model input/output names are missing');
        input = new ort.Tensor('float32', preprocessRGBA(original.data, width, height), [1, 3, SIZE, SIZE]);
        progress('inference', 0.4);
        const outputs = await session.run({ [inputName]: input }, [outputName]);
        output = outputs[outputName];
        progress('masking', 0.85);
        if (!output || output.dims.length !== 4 || output.dims[0] !== 1 || output.dims[1] !== 1 ||
            output.dims[2] !== SIZE || output.dims[3] !== SIZE || output.data.length !== SIZE * SIZE) {
            throw new Error('Expected model saliency shape [1,1,320,320]');
        }
        const mask = resizeMask(normalizeMask(output.data), SIZE, SIZE, width, height);
        const pixels = applyMaskToRGBA(original.data, mask);
        const result = typeof document !== 'undefined' ? document.createElement('canvas') :
            new OffscreenCanvas(width, height);
        result.width = width;
        result.height = height;
        const resultContext = result.getContext('2d');
        if (!resultContext) throw new Error('An output 2D canvas context is required');
        const image = resultContext.createImageData(width, height);
        image.data.set(pixels);
        resultContext.putImageData(image, 0, 0);
        progress('done', 1);
        return result;
    } finally {
        // ORT's session disposal API is release(), not dispose().
        try {
            input?.dispose();
            output?.dispose();
        } finally {
            if (session) await session.release();
        }
    }
}
