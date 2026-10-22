# ZeMA Halle 10 – Digital Twin (browser game)

**Play:** https://raasaar-org.github.io/zema-digital-twin/

A walkable 3D twin of ZeMA Halle 10 in the browser. Walk through the hall, discover the 13 stations, 4 info points
and the new Unitree G1 with Dex3 hands, and switch to the real 360° photo of the virtual tour at any time.
The hall was reconstructed from the ZeMA virtual tour (rundgang.zema.de) plus hand-held video. The G1 is new and not
part of the tour; it stands in the area "KI-gestützte Inspektion zerspanter Bauteile".

It is a static site with no build step and no server calls (three.js 0.185.1, three-mesh-bvh 0.9.15, vendored).
It needs a WebGL2 browser. It is playable after about 8.5 MB; the high-quality hall (37 MB) loads in the background.

## Controls

| key | action |
|---|---|
| WASD / arrows, mouse | walk (Shift runs), look (click to capture the mouse, Esc releases it) |
| E | info card of the nearby station |
| Tab or ★ | checklist of all 18 places; click one to teleport |
| M | big map; click to teleport |
| P | real tour photo of the nearest panorama |
| `[` `]` | previous / next panorama |
| T | photo texture on/off |
| Space | jump |
| H | help |

On touch screens: left thumb walks, swipe on the right half to look.

URL parameters: `?lang=en`, `?quality=low|medium|high`, `?spawn=g1_unitree`, `?nolock=1` (drag to look).

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

`file://` does not work, because browsers block ES modules and `fetch` from local files.

## Limitations

The twin matches the tour closely when seen from the tour's camera positions. Between them it is a visible
reconstruction: thin structures such as truss towers, posts and glass are fragmented or missing, and the south and
west parts of the hall are barely covered. Three stations (Flexible Montage, Ergonomieverbesserung, MRK Industrie 4.0)
are available as photos only.

## Licences

- **Photos, texts, panoramas and the hall textures baked from them:** © ZeMA gGmbH (virtual tour), all rights
  reserved. They are not covered by any open-source licence.
- **Unitree G1 model:** Unitree Robotics, BSD-3-Clause.
- **Third-party code:** three.js (MIT), three-mesh-bvh (MIT), meshopt decoder / ktx-parse / zstddec (MIT), Basis
  Universal transcoder (Apache-2.0), zstd (BSD-3-Clause). Full texts are in `vendor/LICENSES/`, versions and hashes
  are in `vendor/VENDOR.md`.
- No 3DVista player code is included.
