# VTracer local UI

Cập nhật 2026-11-11. Hai màn `#home`, `#editor`; không đăng nhập/thanh toán, không trang xuất riêng, không bảng màu/mẫu hoa trên so sánh.

- Tài nguyên trang trí tạo bằng `cx/gpt-image-2.6-sunburst`, PNG nguồn 2172×724 RGB, tách ba panel WebP. Prompt/provenance trong `assets/welcome-sunburst-20261111/recipe.json`. Mèo minh họa là ảnh trang trí AI, không phải kết quả VTracer.
- Chọn/kéo/dán PNG/JPEG/WebP/BMP tại máy: 20 MiB, 10.000 px mỗi chiều, 16 triệu pixel. Dùng parser header chung trước decode, không SVG đầu vào.
- Vector mặc định `don_gian` (Đồ họa phẳng), đủ tám tham số; `path_precision` là số chữ số tọa độ SVG.
- Hai chế độ độc lập: Vector hóa dùng Worker/WASM gốc; Upscale dùng module AI gốc 2×/4×, đầu ra PNG, không tự nối sang trace. Không gửi ảnh lên server.
- So sánh hai ảnh song song, zoom/pan đồng bộ; 1:1 dựa kích thước pixel kết quả. Không thanh gạt/phác thảo.
- Xuất SVG/PDF/EPS/DXF/PNG dùng module export hiện có; SVG mặc định cho vector, PNG cho upscale. Xuất vật lý mặc định 96 DPI, không chứng nhận in thực tế.
- Hủy tác vụ, nạp ảnh mới và đổi chế độ vô hiệu kết quả cũ; tài nguyên blob/Worker dọn sau dùng.

- Tab Chỉnh sửa dùng bong bóng lồng nhau: bóng lớn là màu đầu ra, bóng nhỏ là màu SVG trước chỉnh sửa. Kéo gộp/tách/di chuyển; chọn vùng, sửa, xóa và đặt lại tác động lên SVG tải xuống. So sánh không hiện bảng màu.
- Kích thước bóng dùng trọng số ước lượng theo bounding box path, không phải tỷ lệ pixel/diện tích mực chính xác. Không tái dựng ánh xạ màu raster ban đầu.
- `palette-model.js` cung cấp hàm bố trí; dữ liệu mẫu cũ không hiển thị trong UI. Kiểm tra: `node opendesign/mockups/vectorizer-reference/palette.test.mjs`.

App gốc ở root không đổi giao diện. UI chạy tại đường dẫn OpenDesigner; chưa deploy.
