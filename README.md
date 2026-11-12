# VTracer Studio

Studio vector tiếng Việt, xử lý trong trình duyệt. VTracer + visioncortex chạy WASM trong Worker. Không tài khoản, backend xử lý ảnh, telemetry hay upload ảnh. Thư viện/model self-host cùng website.

## Giao diện đang phát hành

GitHub Pages mở giao diện đã duyệt tại `opendesign/mockups/vectorizer-reference/`; trang gốc chuyển hướng bằng đường dẫn tương đối. Mã Studio cũ giữ trong repo để tham khảo, không phải trang vào hiện tại.

- Chọn/kéo/dán ảnh; Vector hóa và Upscale độc lập. So sánh hai khung; Chỉnh sửa dành cho SVG với palette bong bóng gộp/tách/đổi/xóa màu. Mũi tên cạnh panel để thu/mở công cụ.
- Thanh Upscale 0–4×, bước 0,1. 0 giữ gốc; dưới 1 thu nhỏ lọc diện tích, không AI; từ 1 dùng ESRGAN Slim x2/x4 theo ô rồi lấy mẫu về kích thước yêu cầu. Hai khung Upscale zoom/pan riêng; 1:1 dùng pixel thật.
- Preset: ngưỡng góc 85, độ dài đoạn 1, ngưỡng nối 30, tọa độ SVG 5 chữ số, tối đa 20 vòng. Các thông số màu/lọc nhiễu khác theo preset.
- Bóng palette dùng bounding box path ước lượng, không phải tỷ lệ mực/pixel chính xác. Cụm nhiều sắc có phân trang; màu gốc là màu trace trước chỉnh sửa.
- `tests/upscale-quality.html` kiểm tra hai ảnh trang trí giảm kích thước/làm mờ. AI cải thiện nhẹ trên hai mẫu, không chứng minh mọi ảnh đều nét hơn hay phục hồi được chi tiết mất.

## Studio cũ (giữ tham khảo)

### Quy trình

1. Chọn PNG, JPEG, WebP, BMP; kéo thả, clipboard hoặc ảnh mẫu tạo tại máy.
2. Chuẩn bị (tùy chọn): cắt ảnh, xóa nền màu từ mép/toàn ảnh hoặc AI U²-Net compact, gom bảng màu. Upscale độc lập 2×/4× xuất PNG hoặc bật tiền xử lý trước trace (mặc định tắt).
3. Vector hóa: preset đồng bộ đủ 8 thông số, spline/đa giác/biên pixel, chồng lớp/khoét vùng. Thử khớp chữ nhật/elip là tùy chọn bảo thủ, không phải engine Vectorizer.AI.
4. Chỉnh & xuất: đổi/xóa vùng hay mọi vùng cùng màu; hoàn tác 12 bước. SVG/PDF/EPS/DXF/PNG, khổ mm, giữ tỷ lệ. Zoom/pan đồng bộ và thanh so sánh.

Không lấy mã hay dùng API độc quyền Vectorizer.AI. Giao diện riêng, tích hợp thư viện có giấy phép.

## Giới hạn

- 20 MiB/file, 10.000 px mỗi chiều, 16 triệu pixel. Kiểm header trước decode và kích thước sau decode. AI upscale đầu vào tối đa 4.096 px mỗi chiều; đầu ra theo giới hạn chung. Không đảm bảo mọi ảnh trong giới hạn đều đủ RAM.
- Editor từ chối SVG trên 20 triệu ký tự hoặc 20.000 vùng trước khi vào DOM. Giảm màu hoặc tăng lọc nhiễu nếu vượt.
- Trace alpha nhị phân: <128 trong suốt, ≥128 đục. PNG giữ alpha mềm. Không tự xóa trắng nếu chưa chọn xóa nền.
- Xóa màu từ mép giữ đảo cùng màu bị bao kín; xóa toàn màu có thể mất trắng bên trong. Lấy màu từ ảnh gốc. U²-Net-p nhận chủ thể ở 320×320: tóc/nét mảnh hoặc nền phức tạp có thể mất.
- ESRGAN Slim x2/x4 tự thử WebGL và convolution thật, thất bại thì CPU. Không chứng minh được GPU rời/tích hợp hay hardware từ trình duyệt. CPU chậm, hủy giữa tile, không ngắt được kernel đang chạy. Nội suy Canvas + unsharp mask là lựa chọn nhanh, không phải AI.
- AI có thể đổi nét/chữ và thêm chi tiết giả, không khôi phục chắc chắn chi tiết đã mất. Alpha được phóng to riêng rồi ghép. Không khẳng định ESRGAN tốt nhất mọi ảnh.
- Khớp hình học chỉ contour đơn, không lỗ, đủ gần chữ nhật/elip. Elip xuất bằng 4 cubic Bézier, không phải primitive chính xác. Mặc định tắt; có hoàn tác. Không suy luận đối xứng/đồ thị biên chung độc quyền.
- SVG/PDF/EPS vector; PNG raster theo mm/DPI có pHYs metadata. EPS không alpha mềm. DXF R12 chỉ polyline đường biên xấp xỉ 0,05 mm, ACI gần nhất, không tô vùng/centerline. Kiểm lớp chồng và đường cắt trùng trước sản xuất. DXF dùng tọa độ mm, phần mềm nhận có thể cần chọn đơn vị mm.
- RGB, không chứng nhận CMYK/ICC/PDF/X hay mẫu in thực tế. Preview vùng cắt căn giữa giữ tỷ lệ, không ánh xạ vị trí gốc; zoom 100% theo ảnh gốc.
- Worker trace/xử lý hạn 180 giây. Hủy/rời trang không công bố kết quả muộn. PNG/WebP động chỉ frame browser giải mã, không xuất hoạt ảnh.
- Lần đầu cần mạng tải web/model cùng origin. Không CDN runtime, service worker/PWA hay cam kết mở lại offline. GitHub Pages vẫn có thể ghi log HTTP; extension/browser ngoài phạm vi bảo đảm.

## Build / chạy

Node 24+, npm. Rust 1.97.1, target wasm32-unknown-unknown và wasm-bindgen CLI 0.2.129 nếu dựng lại WASM. File pkg có sẵn cho phát triển UI.

```bash
npm ci --ignore-scripts
```

```bash
npm run build
```

Build bundle PDF/TFJS/Upscaler, model Slim từ package khóa phiên bản; tải U²-Net-p từ release rembg, kiểm SHA-256 cố định. Whitelist file công khai vào `_site/`; không node_modules, backup hay ảnh người dùng. Giấy phép trong THIRD_PARTY_NOTICES.md.

```bash
python -m http.server 8080 --bind 127.0.0.1 --directory _site
```

Không mở file://. Đường dẫn tương đối hỗ trợ subpath GitHub Pages.

```bash
npm test
```

```bash
node tests/upscale-ai.mjs
```

Node assert: header, giá trị 0/preset, hủy/race, palette, giới hạn SVG, 16 hồi quy WASM alpha, raster, xuất file, hình học, AI preprocessing/alpha/tile/cleanup/backend. Mock không thay inference thật; browser kiểm riêng UI, WebGL/CPU, ONNX, PDF, mạng.

Dựng WASM khi sửa Rust:

```bash
cargo build --locked --manifest-path crates/vtracer_wasm/Cargo.toml --release --target wasm32-unknown-unknown
```

```bash
wasm-bindgen --target web --out-dir pkg crates/vtracer_wasm/target/wasm32-unknown-unknown/release/vtracer_wasm.wasm
```

## Triển khai / backup

Workflow `.github/workflows/pages.yml`: Rust checks/build, npm test/build, Pages deploy khi push main. Chọn GitHub Actions làm nguồn Pages.

Backup trước nâng cấp ngày 2026-11-11: commit 2327f2b tại nhánh `backup/pre-studio-20261111`; bản ZIP `../vtracer-web-backup-20261111.zip`, Git bundle `../vtracer-web-backup-20261111.bundle` trên máy phát triển. Nhánh nâng cấp `feature/local-vector-studio`. Build không ghi đè backup.

Chưa kiểm trực tiếp Safari/macOS hoặc mọi GPU/driver; cần thử trên thiết bị đích trước cam kết chất lượng/tốc độ.
