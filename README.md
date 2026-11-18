# Mockup Render Server

Render ảnh mockup sản phẩm cá nhân hoá **theo query param của URL sản phẩm**. Đổi `?background=red&member=3&soc1=blue&name=Nguyen` → ảnh mockup đổi theo, đúng thiết kế sẽ in.

```
https://macorner.co/products/christmas-together-personalized-runner-rug-xma011102vupg
    ?background=red&member=3&soc1=blue&soc2=green&name=Nguyen
                              │
                              ▼
GET /render?url=<URL trên>&w=800&format=webp     →  ảnh WebP ~24KB
```

Server quản lý **danh sách mockup**, **danh sách thiết kế**, **font**; tất cả là JSON + file ảnh, hot-reload khi sửa.

---

## Chạy

```bash
npm install
npm run assets     # sinh bộ mockup/artwork demo (chỉ cần chạy 1 lần)
npm start          # http://localhost:3000  — UI preview + admin
npm run cluster    # production: 1 worker/core
npm run bench      # benchmark trong tiến trình
npm run test       # test render + test UI bằng DOM thật
node scripts/loadtest.js   # load test qua HTTP
```

Mở `http://localhost:3000` → dán URL sản phẩm → chỉnh option bằng swatch/slider, ảnh render lại tức thì; các tab khác liệt kê mockup, design, font, metrics.

---

## Hiệu năng

Đo trên **2 vCPU** (container), mockup 1800×1200, concurrency 8, mỗi request là một tổ hợp option *khác nhau* (worst case — cache luôn trượt):

| Kịch bản | p50 | p95 | Throughput | Kích thước |
|---|---|---|---|---|
| Cold @400px (thumbnail lưới) | 67 ms | 85 ms | **116 req/s** | 12 KB |
| Cold @800px (ảnh sản phẩm) | 130 ms | 154 ms | **60 req/s** | 24 KB |
| Cold @1200px | 222 ms | 513 ms | 31 req/s | 42 KB |
| **Cache hit** | **5 ms** | 16 ms | **2 630 req/s** | — |

Bóc tách thời gian render nguội phía server: **artwork 4.4 ms · composite 2 ms · encode 10.7 ms**.
50 request **giống hệt nhau** lúc cache lạnh → đúng **1** lần render, 49 request dùng chung kết quả, tổng 82 ms.

### Vì sao nhanh — các quyết định có đo đạc

| Quyết định | Trước | Sau |
|---|---|---|
| **Không dùng `resourcesDir` của resvg** (tự nạp ảnh) | 62 ms/lần khởi tạo | ~1 ms |
| **Part cache**: PNG được decode + tint + resize **một lần**, giữ ở RGBA premultiplied | ~4 ms/thẻ `<image>` × 14 = 59 ms | 0 ms (hit 96 %) |
| **Gom layer thành band**: các layer vector không chồng lấn dồn vào 1 lần gọi resvg | 1 lần gọi/layer | 3 lần cho 20 layer |
| **Bỏ `smartSubsample` của WebP** | 46 ms | 6 ms (cùng dung lượng) |
| **Chỉ warp trong bbox vùng in**, không quét cả ảnh | 2.16 M px | 144 K px |
| **Bundle mockup dựng sẵn theo từng width** (base/mask/light đã giải mã) | decode+resize mỗi request | 0 |
| **Hàng đợi giới hạn đồng thời** = số core | p50 382 ms | p50 130 ms |

Ngoài ra: cache 3 tầng (bộ nhớ LRU → đĩa → CDN), single-flight chống thundering herd, ETag + `immutable` cho CDN, artwork raster dùng lại được giữa các mockup của cùng sản phẩm.

---

## API

### Ảnh

| Endpoint | Mô tả |
|---|---|
| `GET /render?url=<product url>` | Render từ URL storefront (cách dùng chính) |
| `GET /render?product=<id>&mockup=<id>&...` | Render theo id |
| `GET /i/:product/:mockup.webp?...` | Dạng path, thân thiện CDN |
| `GET /artwork/:product?...` | File thiết kế phẳng (không mockup) — dùng để in |

Tham số điều khiển (được loại khỏi option thiết kế): `url, product, handle, mockup, w, format, q, mode, fast, v`.

* `w` — chiều rộng, tự khớp về mức gần nhất trong `settings.widths`
* `format` — `webp` (mặc định) · `jpeg` · `png` · `avif`
* `q` — chất lượng 40–100
* `v` — truyền bất kỳ giá trị nào để nhận `Cache-Control: immutable` (dùng khi bạn version URL)

Response header: `x-render-tier` (`render` / `memory` / `disk`), `x-render-ms`, `etag`.

### Quản lý

| Endpoint | Mô tả |
|---|---|
| `GET /api/resolve?url=...` | Dry-run: khớp sản phẩm nào, option sau chuẩn hoá, cảnh báo |
| `GET /api/schema/:product` | Schema option để storefront tự dựng UI cá nhân hoá |
| `GET /api/{products,mockups,designs,fonts,settings}` | Danh sách |
| `PUT/DELETE /api/{products,mockups,designs}/:id` | Sửa catalog (ghi thẳng file JSON) |
| `POST /api/warm` | Pre-render các tổ hợp phổ biến |
| `POST /api/cache/purge?disk=1` | Xoá cache |
| `GET /metrics`, `GET /healthz` | Theo dõi |

---

## Cấu hình

### `data/mockups.json` — danh sách mockup

```jsonc
{
  "id": "rug-hallway",
  "base": "mockups/rug-hallway/base.jpg",     // ảnh chụp thật
  "mask": "mockups/rug-hallway/mask.png",     // trắng = vùng in (viền mềm = khử răng cưa)
  "light": "mockups/rug-hallway/light.png",   // xám 128 = trung tính, <128 tối, >128 sáng
  "displaceMap": "mockups/rug-hallway/displace.png",  // tuỳ chọn: nhăn vải
  "size": [1800, 1200],
  "surface": {
    "type": "quad",
    "points": [[280,520],[1540,470],[1660,880],[200,950]]  // TL,TR,BR,BL của vùng in
  },
  "displace": { "x": 1.5, "y": 1.5 },
  "blend": { "lightStrength": 1, "opacity": 1 }
}
```

Thêm mockup mới = thêm 4 file ảnh + 1 object JSON. Với **ly/cốc** thêm `"cylinder": 0.82` vào `surface` để bẻ cong theo thân trụ.

### `data/designs.json` — danh sách thiết kế

Thiết kế là JSON layer + khai báo option. Option sinh ra UI, URL param, và khoá cache.

```jsonc
{
  "canvas": { "w": 2400, "h": 800, "bg": "{{opt.background.hex}}" },
  "options": [
    { "key": "background", "type": "swatch", "default": "red",
      "values": [{ "value": "red", "hex": "#8d1d1d", "ink": "#f7e8c8", "accent": "#d8b26a" }] },
    { "key": "member", "type": "range", "min": 1, "max": 6, "default": 3 },
    { "key": "name", "type": "text", "maxLength": 20, "default": "The Nguyens" },
    { "key": "soc", "as": "color", "type": "swatch", "allowCustomHex": true,
      "indexed": { "by": "member", "from": 1, "max": 6 },   // -> soc1, soc2, ... theo số member
      "values": [{ "value": "blue", "hex": "#2f6ea8", "aliases": ["xanh"] }] }
  ],
  "layers": [ /* ... */ ]
}
```

**Loại layer**: `rect` · `ellipse` · `path` · `text` · `image` · `pattern` (lát gạch) · `group` · `repeat`.

**Biểu thức** trong mọi thuộc tính:
`{{opt.background.hex}}` · `{{opt.name|upper}}` · `{{opt.name|possessive}}` · `{{canvas.w}}/2 - 40` · `{{slot.x}} + {{slot.w}} * 0.45`
Điều kiện: `"when": "{{opt.member}} >= 3"`, `"when": "{{opt.pet.value}} != none"`.

**`repeat`** trải một template con theo số lượng (ví dụ mỗi thành viên một chiếc tất), tự co giãn cho vừa `maxWidth`:

```jsonc
{ "type": "repeat", "over": "{{members}}", "as": "slot",
  "layout": { "itemW": 215, "itemH": 333, "gap": "auto", "maxWidth": 1450,
              "centerX": 1200, "baselineY": 612, "stagger": 9 },
  "children": [
    { "type": "image", "src": "stocking-body.png", "x": "{{slot.x}}", "y": "{{slot.y}}",
      "w": "{{slot.w}}", "h": "{{slot.h}}", "tint": "{{slot.color.hex}}" }
  ] }
```

**Text tự vừa khung**: `"fit": { "maxWidth": 1350, "minSize": 60 }` — đo bằng advance width thật của glyph (fontkit), nên tên dài tự thu nhỏ thay vì tràn.

### `data/fonts.json` — danh sách font

```jsonc
{ "id": "script", "file": "NothingYouCouldDo-Regular.ttf",
  "fallback": ["smooch", "serif", "unicode"] }
```

Server **kiểm tra glyph coverage trước khi render**: nếu font script không có dấu tiếng Việt, tên "Gia đình Trần" sẽ tự rơi sang font đầu tiên trong chuỗi fallback có đủ glyph, và ghi cảnh báo vào `warnings` của `/api/resolve` — thay vì âm thầm mất dấu hoặc hiện ô vuông.

### `data/products.json` — ánh xạ URL storefront → thiết kế

```jsonc
{
  "handle": "christmas-together-personalized-runner-rug-xma011102vupg",
  "designId": "xmas-together-runner",
  "mockups": ["rug-hallway", "rug-flatlay"],
  "match": { "sku": ["xma011102"], "keywords": ["runner", "rug", "christmas"] },
  "paramAliases": { "members": "member", "bg": "background" }
}
```

Khớp theo thứ tự: handle chính xác → mã SKU nằm trong handle → trùng keyword. Nên khi marketing đổi slug, URL cũ vẫn render đúng.

---

## Tích hợp storefront

```html
<img id="mockup" src="https://render.example.com/render?url=...&w=800" alt="">
<script>
const RENDER = 'https://render.example.com';
function updateMockup() {
  const u = new URL(location.href);                    // URL sản phẩm hiện tại kèm option
  document.getElementById('mockup').src =
    `${RENDER}/render?url=${encodeURIComponent(u)}&w=800&format=webp`;
}
// đổi option -> cập nhật URL -> đổi ảnh
</script>
```

Lấy schema option để tự dựng bộ chọn: `GET /api/schema/:productHandle`.

**Đặt CDN phía trước.** Response đã có ETag + `s-maxage=1 năm`; thêm `&v=<hash>` khi bạn đổi thiết kế để có `immutable`. Khi đó phần lớn traffic không chạm tới server.

---

## Kiến trúc

```
URL sản phẩm
   │  params.js      tách handle + query, chuẩn hoá theo schema, bỏ utm_*/fbclid
   │                 → khoá cache ổn định (option không liên quan không làm vỡ cache)
   ├─ cache.js       L1 bộ nhớ → L2 đĩa → single-flight
   │
   ├─ plan.js        duyệt layer: điều kiện, repeat, group → danh sách node theo thứ tự z
   │                 phân loại raster/vector, tính bbox, gom thành band
   ├─ artboard.js    band vector → resvg (chỉ font, không ảnh)
   │                 band raster → parts.js (PNG đã decode+tint+resize, cache sẵn)
   │                 → artwork RGBA premultiplied
   ├─ assets.js      bundle mockup dựng sẵn theo width: base/mask/light/displace raw,
   │                 homography nghịch đảo, bbox vùng in
   ├─ compose.js     1 vòng lặp trên bbox: warp phối cảnh (+ trụ, + displace)
   │                 → nhân light map → alpha mask → trộn vào ảnh nền
   └─ sharp          encode WebP/JPEG/PNG/AVIF
```

**Bề mặt in** hỗ trợ: tứ giác phối cảnh bất kỳ (thảm, tranh, áo), trụ tròn (ly), bản đồ biến dạng cho nếp vải, và light map vừa đổ bóng vừa bắt sáng.

---

## Ghi chú vận hành

* **Bộ nhớ**: bundle mockup ~4 MB/biến thể width, 26 MB cho 9 biến thể. Chỉnh `settings.widths` để giới hạn.
* **Scale**: `npm run cluster` chạy 1 worker/core, chung socket; cache đĩa dùng chung, cache RAM riêng từng worker.
* **Warm**: `settings.warmOnBoot` pre-render các tổ hợp mặc định (38 biến thể ≈ 2.5 s) nên request đầu tiên không chịu chi phí dựng bundle.
* **`optimizeInBackground`**: bật để tái nén ở mức cao sau khi đã trả ảnh. Mặc định **tắt** — đo được chỉ giảm ~12 % dung lượng WebP nhưng tốn gấp 6 lần CPU, làm throughput giảm 3 lần.
* Asset demo trong `assets/` là ảnh tổng hợp bằng code (`npm run assets`). Thay bằng ảnh chụp thật + file thiết kế thật là chạy production được.

---

## Deploy lên Cloudflare Containers

Engine chạy nguyên vẹn trong container (sharp + resvg là native binary — **không** chạy được trên Workers thường), còn Worker phía trước chỉ làm hai việc: cache ở edge và định tuyến.

```
Khách ──► Worker (edge, ~0ms)
            │ cache HIT  ──► trả ảnh ngay từ CDN, container không hề thức dậy
            │ cache MISS ──► Container (sharp + resvg, cache RAM nóng) ──► render
```

### Yêu cầu

* **Workers Paid** (từ $5/tháng). Containers không có ở bản free — và bản free Workers cũng chỉ cho 10 ms CPU mỗi request, trong khi một lần render nguội cần 20–70 ms.
* **Docker** đang chạy trên máy bạn: `wrangler deploy` build image rồi push lên `registry.cloudflare.com`.

### Ba lệnh

```bash
npm install
npx wrangler login
npx wrangler deploy        # build image → push → deploy Worker + Container
```

Xong sẽ có `https://mockup-render-demo.<subdomain>.workers.dev`.

### Các file liên quan

| File | Vai trò |
|---|---|
| `Dockerfile` | `node:22-slim`, cài deps, lấy font từ npm, sinh mockup demo, chạy `server.js` ở cổng 8080 |
| `wrangler.jsonc` | Khai báo container + Durable Object binding + instance type |
| `worker/index.js` | Worker ở edge: tra `caches.default` trước, miss mới chuyển vào container |

### Vài điểm đã cân nhắc trong cấu hình

* **`instance_type: "standard-2"`** = 1 vCPU / 6 GiB. Các số đo trong README đo trên 2 vCPU — muốn khớp thì đổi sang `standard-3`.
* **Shard theo URL ảnh** (`shardFor` trong `worker/index.js`): cùng một tổ hợp option luôn rơi vào đúng một container instance, nên cache RAM của instance đó mới thực sự được hit. Chia ngẫu nhiên sẽ làm hỏng điều này.
* **`sleepAfter = '5m'`** giữ instance nóng giữa các đợt truy cập — cache RAM và bundle mockup dựng sẵn chính là thứ biến 25 ms thành 0,1 ms. Tăng lên nếu traffic đều, giảm xuống nếu muốn tiết kiệm.
* **`max_instances: 2`** để giữ chi phí demo thấp. Container tính tiền theo thời gian chạy, nên cache ở edge (Worker) là thứ quyết định hoá đơn: request trúng cache không đánh thức container.
* Ảnh image sau build ~170 MB (base `node:22-slim` + 80 MB `node_modules` + 3,6 MB assets), dư sức so với 12 GB disk của `standard-2`.
