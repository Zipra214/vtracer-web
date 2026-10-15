use std::f64::consts::PI;
use std::fmt;
use wasm_bindgen::prelude::*;

use visioncortex::color_clusters::{
    color_same, KeyingAction, Runner, RunnerConfig, HIERARCHICAL_MAX,
};
use visioncortex::{Color, ColorImage, CompoundPath, PathSimplifyMode, PointF64};

#[derive(Debug, Clone)]
struct SvgPath {
    pub path: CompoundPath,
    pub color: Color,
}

#[derive(Debug, Clone)]
struct SvgFile {
    pub paths: Vec<SvgPath>,
    pub width: usize,
    pub height: usize,
    pub path_precision: Option<u32>,
}

impl SvgFile {
    pub fn new(width: usize, height: usize, path_precision: Option<u32>) -> Self {
        Self {
            paths: Vec::new(),
            width,
            height,
            path_precision,
        }
    }

    pub fn add_path(&mut self, path: CompoundPath, color: Color) {
        self.paths.push(SvgPath { path, color });
    }
}

impl fmt::Display for SvgFile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, r#"<?xml version="1.0" encoding="UTF-8"?>"#)?;
        writeln!(
            f,
            r#"<!-- Generator: VTracer WebAssembly (visioncortex) -->"#
        )?;
        writeln!(
            f,
            r#"<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" width="{}" height="{}">"#,
            self.width, self.height, self.width, self.height
        )?;

        for item in &self.paths {
            let (d_str, offset) =
                item.path
                    .to_svg_string(true, PointF64::default(), self.path_precision);
            writeln!(
                f,
                r#"<path d="{}" fill="{}" transform="translate({},{})"/>"#,
                d_str,
                item.color.to_hex_string(),
                offset.x,
                offset.y
            )?;
        }

        writeln!(f, "</svg>")
    }
}

fn find_unused_color(img: &ColorImage) -> Result<Color, String> {
    // Exact RGB occupancy: one image pass and at most 2 MiB, independent of precision.
    let mut used = vec![0u8; 16_777_216 / 8];
    for p in img.pixels.chunks_exact(4) {
        if p[3] != 0 {
            let rgb = ((p[0] as usize) << 16) | ((p[1] as usize) << 8) | p[2] as usize;
            used[rgb >> 3] |= 1 << (rgb & 7);
        }
    }
    let available = |rgb: usize| used[rgb >> 3] & (1 << (rgb & 7)) == 0;
    // Prefer saturated keys. Opaque black is valid: the disabled-key sentinel
    // is transparent black (Color::default()), not Color::new(0, 0, 0).
    for rgb in [
        0xff00ff, 0x00ffff, 0xffff00, 0x00ff00, 0xff0000, 0x0000ff, 0xfe01fe, 0x01fe01,
    ]
    .into_iter()
    .chain(0..16_777_216)
    {
        if available(rgb) {
            return Ok(Color::new((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8));
        }
    }
    Err("Không tìm được màu key cho nền trong suốt".to_string())
}

#[allow(clippy::too_many_arguments)] // Flat C/WASM ABI across worker boundary
fn convert_raw_rgba_internal(
    raw_rgba: &[u8],
    width: usize,
    height: usize,
    colormode: &str,
    hierarchical: &str,
    mode: &str,
    filter_speckle: usize,
    color_precision: i32,
    layer_difference: i32,
    corner_threshold: i32,
    length_threshold: f64,
    max_iterations: usize,
    splice_threshold: i32,
    path_precision: i32,
    alpha_handling: &str,
) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("Chiều rộng và chiều cao phải lớn hơn 0".to_string());
    }
    if width > 10_000 || height > 10_000 {
        return Err("Chiều rộng hoặc chiều cao không được vượt quá 10.000 pixel".to_string());
    }
    let total_pixels = width.checked_mul(height).ok_or("Kích thước ảnh tràn số")?;
    if total_pixels > 16_000_000 {
        return Err("Tổng số pixel không được vượt quá 16 triệu".to_string());
    }
    let expected_len = total_pixels
        .checked_mul(4)
        .ok_or("Kích thước buffer tràn số")?;
    if raw_rgba.len() != expected_len {
        return Err("Kích thước buffer RGBA không khớp width * height * 4".to_string());
    }

    if colormode != "color" && colormode != "binary" {
        return Err("Chế độ màu không hợp lệ: phải là 'color' hoặc 'binary'".to_string());
    }
    if hierarchical != "stacked" && hierarchical != "cutout" {
        return Err("Cấu trúc phân tầng không hợp lệ: phải là 'stacked' hoặc 'cutout'".to_string());
    }
    if mode != "spline" && mode != "polygon" && mode != "none" {
        return Err(
            "Chế độ làm mịn không hợp lệ: phải là 'spline', 'polygon' hoặc 'none'".to_string(),
        );
    }
    if alpha_handling != "preserve" && alpha_handling != "white_background" {
        return Err(
            "Xử lý alpha không hợp lệ: phải là 'preserve' hoặc 'white_background'".to_string(),
        );
    }

    if filter_speckle > 100 {
        return Err("filter_speckle phải trong khoảng 0..=100".to_string());
    }
    if !(1..=8).contains(&color_precision) {
        return Err("color_precision phải trong khoảng 1..=8".to_string());
    }
    if !(0..=255).contains(&layer_difference) {
        return Err("layer_difference phải trong khoảng 0..=255".to_string());
    }
    if !(0..=180).contains(&corner_threshold) {
        return Err("corner_threshold phải trong khoảng 0..=180".to_string());
    }
    if !(0..=180).contains(&splice_threshold) {
        return Err("splice_threshold phải trong khoảng 0..=180".to_string());
    }
    if !length_threshold.is_finite() || !(0.1..=20.0).contains(&length_threshold) {
        return Err("length_threshold phải là số hữu hạn trong khoảng 0.1..=20.0".to_string());
    }
    if !(1..=20).contains(&max_iterations) {
        return Err("max_iterations phải trong khoảng 1..=20".to_string());
    }
    if !(-1..=8).contains(&path_precision) {
        return Err("path_precision phải trong khoảng -1..=8".to_string());
    }

    let mut pixels = raw_rgba.to_vec();
    let is_white_bg = alpha_handling == "white_background";

    let mut has_transparency = false;
    for chunk in pixels.chunks_exact_mut(4) {
        let a = chunk[3] as u32;
        if is_white_bg {
            if a < 255 {
                // True alpha composite over white background (255, 255, 255) with integer rounding
                chunk[0] = ((chunk[0] as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
                chunk[1] = ((chunk[1] as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
                chunk[2] = ((chunk[2] as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
            }
            chunk[3] = 255;
        } else {
            // Flat artwork silhouette: threshold 128
            if a < 128 {
                chunk[3] = 0;
                has_transparency = true;
            } else {
                chunk[3] = 255;
            }
        }
    }

    let mut img = ColorImage {
        pixels,
        width,
        height,
    };

    let is_cutout = hierarchical == "cutout";
    let is_binary = colormode == "binary";

    let simplify_mode = match mode {
        "polygon" => PathSimplifyMode::Polygon,
        "none" => PathSimplifyMode::None,
        _ => PathSimplifyMode::Spline,
    };

    let filter_speckle_area = filter_speckle * filter_speckle;
    let color_precision_loss = (8 - color_precision).clamp(0, 8);
    let corner_rad = (corner_threshold as f64) * PI / 180.0;
    let splice_rad = (splice_threshold as f64) * PI / 180.0;
    let path_prec_opt = if path_precision >= 0 {
        Some(path_precision as u32)
    } else {
        None
    };

    if is_binary {
        // Binary mode: transparent pixels (a == 0) are never foreground
        let bin_img = img.to_binary_image(|x| x.a != 0 && x.r < 128);
        let clusters = bin_img.to_clusters(false);
        let mut svg = SvgFile::new(width, height, path_prec_opt);
        for i in 0..clusters.len() {
            let cluster = clusters.get_cluster(i);
            if cluster.size() >= filter_speckle_area {
                let paths = cluster.to_compound_path(
                    simplify_mode,
                    corner_rad,
                    length_threshold,
                    max_iterations,
                    splice_rad,
                );
                svg.add_path(paths, Color::new(0, 0, 0));
            }
        }
        return Ok(svg.to_string());
    }

    let key_color = if has_transparency && !is_white_bg {
        let key = find_unused_color(&img)?;
        for y in 0..height {
            for x in 0..width {
                if img.get_pixel(x, y).a == 0 {
                    img.set_pixel(x, y, &key);
                }
            }
        }
        key
    } else {
        Color::default()
    };

    let runner = Runner::new(
        RunnerConfig {
            diagonal: layer_difference == 0,
            hierarchical: HIERARCHICAL_MAX,
            batch_size: 25600,
            good_min_area: filter_speckle_area,
            good_max_area: width * height,
            is_same_color_a: color_precision_loss,
            is_same_color_b: 1,
            deepen_diff: layer_difference,
            hollow_neighbours: 1,
            key_color,
            // Never merge keyed pixels into foreground through deepen_diff.
            keying_action: KeyingAction::Discard,
        },
        img,
    );

    let mut clusters = runner
        .builder()
        // Key pixels must never compare similar to artwork, even at precision 1.
        .same(move |a, b| {
            a != key_color && b != key_color && color_same(a, b, color_precision_loss, 1)
        })
        .run();

    if is_cutout {
        let view = clusters.view();
        let mut image = view.to_color_image();
        // Clustering can produce new average colors. Reserve an exact unused key
        // against the actual second-pass palette, then exclude it from similarity.
        let key_color = if has_transparency {
            find_unused_color(&image)?
        } else {
            Color::default()
        };
        if has_transparency {
            // Discarded pixels rasterize as transparent black. Restore the key
            // before pass two, without exposing it to first-pass color merging.
            for (source, pixel) in raw_rgba
                .chunks_exact(4)
                .zip(image.pixels.chunks_exact_mut(4))
            {
                if source[3] < 128 {
                    pixel.copy_from_slice(&[key_color.r, key_color.g, key_color.b, key_color.a]);
                }
            }
        }
        let runner = Runner::new(
            RunnerConfig {
                diagonal: false,
                hierarchical: 64,
                batch_size: 25600,
                good_min_area: 0,
                good_max_area: image.width * image.height,
                is_same_color_a: 0,
                is_same_color_b: 1,
                deepen_diff: 0,
                hollow_neighbours: 0,
                key_color,
                keying_action: KeyingAction::Discard,
            },
            image,
        );
        clusters = runner
            .builder()
            .same(move |a, b| a != key_color && b != key_color && color_same(a, b, 0, 1))
            .run();
    }

    let view = clusters.view();
    let mut svg = SvgFile::new(width, height, path_prec_opt);

    for &cluster_index in view.clusters_output.iter().rev() {
        let cluster = view.get_cluster(cluster_index);
        let paths = cluster.to_compound_path(
            &view,
            false,
            simplify_mode,
            corner_rad,
            length_threshold,
            max_iterations,
            splice_rad,
        );
        svg.add_path(paths, cluster.residue_color());
    }

    Ok(svg.to_string())
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)] // Flat C/WASM ABI across worker boundary
pub fn convert_raw_rgba(
    raw_rgba: &[u8],
    width: usize,
    height: usize,
    colormode: &str,
    hierarchical: &str,
    mode: &str,
    filter_speckle: usize,
    color_precision: i32,
    layer_difference: i32,
    corner_threshold: i32,
    length_threshold: f64,
    max_iterations: usize,
    splice_threshold: i32,
    path_precision: i32,
    alpha_handling: &str,
) -> Result<String, JsValue> {
    convert_raw_rgba_internal(
        raw_rgba,
        width,
        height,
        colormode,
        hierarchical,
        mode,
        filter_speckle,
        color_precision,
        layer_difference,
        corner_threshold,
        length_threshold,
        max_iterations,
        splice_threshold,
        path_precision,
        alpha_handling,
    )
    .map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solid_color_square() {
        let width = 16;
        let height = 16;
        let mut raw = Vec::with_capacity(width * height * 4);
        for _ in 0..(width * height) {
            raw.extend_from_slice(&[200, 50, 50, 255]);
        }
        let svg = convert_raw_rgba_internal(
            &raw, width, height, "color", "stacked", "spline", 4, 6, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("vectorization should succeed");

        assert!(svg.contains("<svg"));
        assert!(svg.contains("<path"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn test_alpha_silhouette_preserves_transparent_background() {
        let width = 32;
        let height = 32;
        let mut raw = vec![0u8; width * height * 4];
        for y in 8..24 {
            for x in 8..24 {
                let idx = (y * width + x) * 4;
                raw[idx] = 220;
                raw[idx + 1] = 40;
                raw[idx + 2] = 40;
                raw[idx + 3] = 255;
            }
        }

        // Preserve mode: only 1 path for the red center, no background path
        let svg_preserve = convert_raw_rgba_internal(
            &raw, width, height, "color", "stacked", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("preserve mode should succeed");

        let path_count = svg_preserve.matches("<path").count();
        assert_eq!(
            path_count, 1,
            "preserve mode should have exactly 1 path (no bg)"
        );

        // White background mode: should have 2 paths (white bg + red center)
        let svg_white = convert_raw_rgba_internal(
            &raw,
            width,
            height,
            "color",
            "stacked",
            "spline",
            2,
            6,
            16,
            60,
            4.0,
            10,
            45,
            2,
            "white_background",
        )
        .expect("white background mode should succeed");

        let white_path_count = svg_white.matches("<path").count();
        assert!(
            white_path_count >= 2,
            "white bg mode should have bg and foreground paths"
        );
    }

    #[test]
    fn test_all_transparent_returns_empty_svg() {
        let width = 16;
        let height = 16;
        let raw = vec![0u8; width * height * 4];
        let svg = convert_raw_rgba_internal(
            &raw, width, height, "color", "stacked", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("all transparent should produce valid empty SVG");

        assert!(svg.contains("<svg"));
        assert_eq!(svg.matches("<path").count(), 0);
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn test_alpha_composite_exact_math() {
        // Pixel: red (200, 0, 0, 128)
        // Expected blended with white: ((200 * 128 + 255 * 127 + 127) / 255) = 227 (#e3)
        // G/B: ((0 * 128 + 255 * 127 + 127) / 255) = 127 (#7f)
        let width = 8;
        let height = 8;
        let mut raw = Vec::with_capacity(width * height * 4);
        for _ in 0..(width * height) {
            raw.extend_from_slice(&[200, 0, 0, 128]);
        }
        let svg = convert_raw_rgba_internal(
            &raw,
            width,
            height,
            "color",
            "stacked",
            "spline",
            2,
            8,
            16,
            60,
            4.0,
            10,
            45,
            2,
            "white_background",
        )
        .expect("white background composite should succeed");

        assert!(svg.contains("<svg"));
        assert!(svg.contains("<path"));
        assert!(svg.contains("fill=\"#E37F7F\""));
    }

    #[test]
    fn test_internal_hole_and_opaque_white() {
        let width = 32;
        let height = 32;
        let mut raw = vec![0u8; width * height * 4];
        for y in 0..height {
            for x in 0..width {
                let idx = (y * width + x) * 4;
                if (12..20).contains(&x) && (12..20).contains(&y) {
                    // transparent hole
                    raw[idx + 3] = 0;
                } else if (8..24).contains(&x) && (8..24).contains(&y) {
                    // opaque white
                    raw[idx] = 255;
                    raw[idx + 1] = 255;
                    raw[idx + 2] = 255;
                    raw[idx + 3] = 255;
                } else {
                    // black border
                    raw[idx] = 10;
                    raw[idx + 1] = 10;
                    raw[idx + 2] = 10;
                    raw[idx + 3] = 255;
                }
            }
        }

        // Stacked mode preserves white square
        let svg_stacked = convert_raw_rgba_internal(
            &raw, width, height, "color", "stacked", "spline", 1, 8, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("stacked mode should succeed");
        assert!(svg_stacked.contains("fill=\"#FFFFFF\""));

        // Cutout mode preserves white square
        let svg_cutout = convert_raw_rgba_internal(
            &raw, width, height, "color", "cutout", "spline", 1, 8, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("cutout mode should succeed");
        assert!(svg_cutout.contains("fill=\"#FFFFFF\""));
    }

    #[test]
    fn test_binary_mode_ignores_transparent() {
        let width = 16;
        let height = 16;
        let mut raw = vec![0u8; width * height * 4]; // all transparent
                                                     // Add a 4x4 black box
        for y in 6..10 {
            for x in 6..10 {
                let idx = (y * width + x) * 4;
                raw[idx] = 10;
                raw[idx + 1] = 10;
                raw[idx + 2] = 10;
                raw[idx + 3] = 255;
            }
        }
        let svg = convert_raw_rgba_internal(
            &raw, width, height, "binary", "stacked", "spline", 1, 6, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("binary mode should succeed");

        assert!(svg.contains("<svg"));
        assert_eq!(svg.matches("<path").count(), 1);
    }

    #[test]
    fn test_color_precision_8_loss_0() {
        let width = 8;
        let height = 8;
        let mut raw = Vec::with_capacity(width * height * 4);
        for _ in 0..(width * height) {
            raw.extend_from_slice(&[100, 150, 200, 255]);
        }
        let svg = convert_raw_rgba_internal(
            &raw, width, height, "color", "stacked", "spline", 2, 8, 16, 60, 4.0, 10, 45, 2,
            "preserve",
        )
        .expect("precision 8 should succeed");
        assert!(svg.contains("<path"));
    }

    #[test]
    fn test_near_magenta_key_preserves_canvas_transparency() {
        let width = 32;
        for rgb in [[254, 0, 254], [250, 5, 250]] {
            let mut raw = vec![0u8; width * width * 4];
            for y in 8..24 {
                for x in 8..24 {
                    let i = (y * width + x) * 4;
                    raw[i..i + 3].copy_from_slice(&rgb);
                    raw[i + 3] = 255;
                }
            }
            for precision in [1, 6, 8] {
                for hierarchy in ["stacked", "cutout"] {
                    let svg = convert_raw_rgba_internal(
                        &raw, width, width, "color", hierarchy, "none", 0, precision, 16, 60, 4.0,
                        10, 45, 2, "preserve",
                    )
                    .expect("near-key artwork should convert");
                    let expected = format!(
                        r##"<path d="M0,0 L16,0 L16,16 L0,16 Z " fill="#{:02X}{:02X}{:02X}" transform="translate(8,8)"/>"##,
                        rgb[0], rgb[1], rgb[2],
                    );
                    assert_eq!(svg.matches("<path").count(), 1, "{svg}");
                    assert!(svg.contains(&expected), "{hierarchy}, {precision}: {svg}");
                }
            }
        }
    }

    #[test]
    fn test_transparent_hole_geometry() {
        let width = 32;
        let mut raw = vec![0u8; width * width * 4];
        for y in 0..width {
            for x in 0..width {
                if !(8..24).contains(&x) || !(8..24).contains(&y) {
                    let i = (y * width + x) * 4;
                    raw[i..i + 4].copy_from_slice(&[220, 40, 40, 255]);
                }
            }
        }
        for hierarchy in ["stacked", "cutout"] {
            let svg = convert_raw_rgba_internal(
                &raw, width, width, "color", hierarchy, "none", 0, 8, 16, 60, 4.0, 10, 45, 2,
                "preserve",
            )
            .expect("ring should convert");
            // Outer contour and opposite-winding inner contour keep center unpainted
            // under SVG's default nonzero fill rule; checking path count alone misses this.
            assert_eq!(svg.matches("<path").count(), 1, "{svg}");
            assert!(
                svg.contains(r#"d="M0,0 L32,0 L32,32 L0,32 Z M8,8 L8,24 L24,24 L24,8 Z ""#),
                "{hierarchy}: {svg}"
            );
        }
    }

    #[test]
    fn test_key_search_exact_fallback() {
        let colors = [
            [255, 0, 255],
            [0, 255, 255],
            [255, 255, 0],
            [0, 255, 0],
            [255, 0, 0],
            [0, 0, 255],
            [254, 1, 254],
            [1, 254, 1],
        ];
        let img = ColorImage {
            pixels: colors
                .iter()
                .flat_map(|c| [c[0], c[1], c[2], 255])
                .collect(),
            width: colors.len(),
            height: 1,
        };
        let key = find_unused_color(&img).expect("fallback should find unused color");
        assert_eq!(key, Color::new(0, 0, 0));
        for c in colors {
            assert_ne!(key, Color::new(c[0], c[1], c[2]));
        }
        assert_ne!(key, Color::default());
        let transparent = ColorImage {
            pixels: vec![0; 4],
            width: 1,
            height: 1,
        };
        assert!(find_unused_color(&transparent).is_ok());
    }

    #[test]
    fn test_dense_quantized_gamut_with_transparency() {
        // Every four-bit RGB bin is occupied; a similarity-separated key cannot
        // exist, but an exact unused RGB still can and must convert at precision 4.
        let mut raw = Vec::with_capacity(64 * 65 * 4);
        for r in 0..16 {
            for g in 0..16 {
                for b in 0..16 {
                    raw.extend_from_slice(&[r * 16, g * 16, b * 16, 255]);
                }
            }
        }
        raw.resize(64 * 65 * 4, 0);
        for hierarchy in ["stacked", "cutout"] {
            let svg = convert_raw_rgba_internal(
                &raw, 64, 65, "color", hierarchy, "none", 0, 4, 16, 60, 4.0, 10, 45, 2, "preserve",
            )
            .expect("dense gamut must not exhaust key space");
            assert!(svg.contains("<path"), "{hierarchy}: {svg}");
        }
    }

    #[test]
    fn test_invalid_parameters_rejected() {
        let raw = vec![0u8; 64];
        // 0 dimensions
        assert!(convert_raw_rgba_internal(
            &raw, 0, 4, "color", "stacked", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        // Buffer length mismatch
        assert!(convert_raw_rgba_internal(
            &raw, 4, 5, "color", "stacked", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        // Invalid enum
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "unknown", "stacked", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "color", "wrong", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "color", "stacked", "wrong", 2, 6, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "color", "stacked", "spline", 2, 6, 16, 60, 4.0, 10, 45, 2, "wrong"
        )
        .is_err());
        // Out of range numeric
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "color", "stacked", "spline", 101, 6, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "color", "stacked", "spline", 2, 0, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        assert!(convert_raw_rgba_internal(
            &raw, 4, 4, "color", "stacked", "spline", 2, 9, 16, 60, 4.0, 10, 45, 2, "preserve"
        )
        .is_err());
        assert!(convert_raw_rgba_internal(
            &raw,
            4,
            4,
            "color",
            "stacked",
            "spline",
            2,
            6,
            16,
            60,
            f64::NAN,
            10,
            45,
            2,
            "preserve"
        )
        .is_err());
    }
}
