# Kho ảnh AI → asset của render server

Ảnh gốc do model ảnh (gpt-image) sinh ra, mỗi mảnh một tấm, nền giả-trong-suốt
(ca-rô) hoặc nền magenta phẳng. Pipeline ba bước, chạy lại được:

```sh
sh scripts/ai-assets/fetch.sh          # tải ảnh gốc theo manifest.json -> artgen/raw
python3 scripts/dekey.py artgen/raw/*.png   # tách nền -> *-cut.png
python3 scripts/ingest_ai_assets.py    # cắt viền, tách cổ tất, dò mask/light/4 góc
```

- `dekey.py` — nhận nền theo nhịp ca-rô (không phụ thuộc pha) hoặc khoá màu
  magenta kèm khử ám màu; giữ nguyên mảng trắng phẳng của vật thể.
- `ingest_ai_assets.py` — tạo `assets/art/*` (tất tách thân/cổ để tint màu) và
  `assets/mockups/<id>/{base.jpg,mask.png,light.jpg}` + in ra 4 góc mặt in để
  dán vào `data/mockups.json`.

Link trong `manifest.json` hết hạn sau 7 ngày kể từ lúc tạo ảnh; sau đó cần
tạo lại ảnh hoặc giữ bản `artgen/raw` đã tải.
