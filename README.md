# ZeMA Halle 10 – Digital Twin (browser game)

**Play:** https://raasaar-org.github.io/zema-digital-twin/

A walkable 3D twin of ZeMA Halle 10 in the browser. Walk through the hall, discover the 13 stations, 4 info points
and the Unitree G1 with Dex3 hands, and switch to the real 360° photo of the virtual tour at any time.
The hall was reconstructed from the ZeMA virtual tour (rundgang.zema.de) plus a hand-held video of the hall.
The G1 is not part of the tour; it stands in the area "KI-gestützte Inspektion zerspanter Bauteile".

It is a static site with no build step and no server calls (three.js 0.185.1, three-mesh-bvh 0.9.15 and Spark 2.3.1,
all vendored). It needs a WebGL2 browser.

## What is new

- **The G1 station as it is today is the default.** Modelled from the hand-held video: posts with red belt
  barriers, a yellow mat and a black gantry with the G1 hanging in its harness. The G1
  has the real robot's look (silver shells, black joints, helmet and Dex3 hands, blue wrist rings, visor).
  It is there from the first frame: the game starts only once the station and the G1 have loaded.
  `?station=tour` (or the settings panel) shows the station as it was on the tour day, with the G1 standing at the
  tool-cabinet spot.
- **Tour photos merged with today's station:** in a tour photo (the intro, key P, or "Tour photo (with today's
  station)" on the G1 card) the photo stays the picture with today's G1, gantry, posts, red belts and yellow mat
  drawn into it. Only where it shows what is gone today (the old black cell and the green cabinet) the 3D hall without
  them shows through, with a short soft edge. There is no double exposure of the two days.
- **Splat photo layer:** 1.24 million Gaussian splats from the hand-held video of the hall, along the main aisle.
  Per view one source is drawn, never both half-transparent: the splats while you are within about 5 m of the walked
  aisle and look along it, the projected tour photos near a tour spot, the 3D hall elsewhere; a switch is a short cross-fade.
  It switches on by itself on capable desktops (quality medium or high, no touch screen, hardware GPU) after
  everything else has loaded, and switches off again if the frame rate stays below 30 fps. Toggle it with key **G**,
  the ✦ button or the settings; force it with `?splats=1` or `?splats=0`.
- **Hall:** more geometry and sharper texture along the main aisle, taken from the hand-held video.
- **Big map:** labels no longer overlap. **Start screen:** shows readable loading steps.

Along the main aisle the hall, the splat layer and the G1 station show the day of the hand-held video (other
banners, moved exhibits, people in the splats). The tour photos and the other stations show the tour day.

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
| G | splat photo layer on/off |
| Space | jump |
| H | help |

On touch screens: left thumb walks, swipe on the right half to look.

## URL parameters

| parameter | values | effect |
|---|---|---|
| `lang` | `de`, `en` | language |
| `quality` | `low`, `medium`, `high` | renderer quality (default: `high` on desktops, `medium` on touch and low-memory devices; drops to `medium` by itself on a slow GPU). `low` / `medium` never load the high-quality hall |
| `station` | `present`, `tour` | G1 station today (default) or in the tour state |
| `splats` | `1`, `0` | splat photo layer on / off (default: automatic) |
| `spawn` | a station id | start at that station, e.g. `?spawn=g1_unitree` |
| `autostart=1` | | skip the start screen (add `intro=1` to still play the intro) |
| `nolock=1` | | no pointer lock (drag to look) |

## Size

About 124 MB in 149 files. Largest files: `web_data/hall_hi.glb` 40.3 MB and `web_data/splats/hall_aisle.spz`
27.4 MB, so every file is below GitHub's 50 MB limit. The site is playable after about 11 MB (engine, collider,
low-quality hall, maps and today's G1 station collider); today's station (about 4 MB) loads right after. On quality
high the 40 MB hall and the 4096 px photos load in the background; the splat layer (27.4 MB plus the 2.7 MB Spark
renderer) is downloaded only when it switches on.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

`file://` does not work, because browsers block ES modules and `fetch` from local files.

## Limitations

The twin matches the tour closely when seen from the tour's camera positions. Between them it is a visible
reconstruction: thin structures such as truss towers, posts and glass are fragmented or missing, and the south and
west parts of the hall are barely covered. The splat layer only covers the main aisle. Where the old black cell
stood, the photos show a plain pale surface behind today's G1 station, and the desks around it are drawn as they
were on the tour day. Three stations (Flexible Montage, Ergonomieverbesserung, MRK Industrie
4.0) are available as photos only.

## Licences

- **Photos, texts, panoramas and the hall textures baked from them:** © ZeMA gGmbH (virtual tour), all rights
  reserved. They are not covered by any open-source licence.
- **Unitree G1 model:** Unitree Robotics, BSD-3-Clause.
- **Third-party code:** three.js (MIT), three-mesh-bvh (MIT), Spark 2.3.1 (MIT, World Labs; bundles fflate (MIT) and
  Rust crates under MIT and/or Apache-2.0), meshopt decoder / ktx-parse / zstddec (MIT), Basis Universal transcoder
  (Apache-2.0), zstd (BSD-3-Clause). Full texts are in `vendor/LICENSES/`, versions and hashes are in
  `vendor/VENDOR.md`.
- No 3DVista player code is included.
