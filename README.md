# VTracer Web

Vector hóa ảnh thành SVG trong trình duyệt, giao diện tiếng Việt. Rust + visioncortex biên dịch sang WebAssembly; xử lý bằng Web Worker. Không backend xử lý ảnh, không tài khoản, không CDN hay telemetry trong mã ứng dụng.

## Dùng

Chọn/kéo thả PNG, JPEG, WebP, BMP hoặc dán ảnh bằng Ctrl+V / Command+V. Chọn preset, xử lý nền, chuyển đổi rồi tải SVG. Trình duyệt quyết định thư mục tải xuống; web không tự ghi nhớ đường dẫn như desktop.

- Tối đa 20 MiB/file, 10.000 pixel mỗi chiều, 16 triệu pixel tổng cộng. Ảnh phức tạp vẫn có thể hết bộ nhớ. Kích thước kiểm tra trước (qua header) và sau khi browser giải mã.
- Giữ alpha: <128 thành trong suốt; ≥128 thành đục. Không giữ bán trong suốt, không tự xóa nền trắng đục. Viền mềm có thể thay đổi.
- Ghép nền trắng: composite RGBA lên trắng trước khi trace.
- PNG/WebP động: chỉ frame browser giải mã lúc nạp; không xuất hoạt ảnh.
- Preset khớp tham số desktop, nhưng engine/runtime khác nên không bảo đảm SVG giống từng byte.
- Hủy bằng kết thúc Worker; tự dừng sau 120 giây. SVG dùng path, không nhúng raster; không chứng nhận chất lượng in/CMYK.

Ảnh được mã ứng dụng xử lý trong bộ nhớ browser, không gửi lên máy chủ. GitHub Pages vẫn phục vụ file web và có thể ghi log HTTP thông thường. Extension/trình duyệt ngoài phạm vi bảo đảm của app. Không service worker, PWA hay cam kết mở lại khi mất mạng.

## Build

Cần Rust 1.97.1, target `wasm32-unknown-unknown`, wasm-bindgen CLI **0.2.129**. Giữ Cargo.lock. Chạy từ thư mục gốc:

```bash
rustup target add wasm32-unknown-unknown
```

```bash
cargo install wasm-bindgen-cli --version 0.2.129 --locked
```

```bash
cargo test --locked --manifest-path crates/vtracer_wasm/Cargo.toml
```

```bash
cargo clippy --locked --manifest-path crates/vtracer_wasm/Cargo.toml -- -D warnings
```

```bash
cargo build --locked --manifest-path crates/vtracer_wasm/Cargo.toml --release --target wasm32-unknown-unknown
```

```bash
wasm-bindgen --target web --out-dir pkg crates/vtracer_wasm/target/wasm32-unknown-unknown/release/vtracer_wasm.wasm
```

Phục vụ bằng HTTP, không mở qua `file://`:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

## GitHub Pages

Workflow `.github/workflows/pages.yml` kiểm tra Rust, build WASM, chỉ đưa file web/giấy phép vào artifact. Chọn GitHub Actions làm nguồn Pages. URL dự kiến https://zipra214.github.io/vtracer-web/ chỉ có hiệu lực sau deployment thành công.

## Kiểm thử / giấy phép

Rust unit tests: `crates/vtracer_wasm/src/lib.rs`. Hai bộ kiểm tra Node không cần dependency:

```bash
node test.mjs
```

```bash
node tests/wasm-alpha.mjs
```

Bộ thứ nhất kiểm tra header ảnh, giới hạn trước giải mã và trạng thái khi rời trang. Bộ thứ hai chạy WASM thật, kiểm tra hình học alpha. Chúng không thay thế kiểm thử browser: trace thật, alpha render, hủy, lỗi đầu vào, layout. Chưa xác nhận Safari/macOS thực tế.

Wrapper/giao diện: MIT. Logic converter/SVG dựa trên VTracer; xem `THIRD_PARTY_NOTICES.md`. Không dùng frontend proprietary upstream.
