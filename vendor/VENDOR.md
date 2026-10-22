# Vendored third-party code (no build step; loaded through the import map in ../index.html)

| package | version (exact) | files | licence |
|---|---|---|---|
| three.js | 0.185.1 (r185, npm `three@0.185.1`, published 2025-07-01) | `three/build/three.module.js`, `three/build/three.core.js`, `three/examples/jsm/{loaders/GLTFLoader.js, loaders/KTX2Loader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js, utils/WorkerPool.js, math/ColorSpaces.js}` | MIT (`three/LICENSE`) |
| meshoptimizer decoder | as shipped in three@0.185.1 `examples/jsm/libs/meshopt_decoder.module.js` | 1 file | MIT (header of the file, (c) Arseny Kapoulkine) |
| ktx-parse | as shipped in three@0.185.1 `examples/jsm/libs/ktx-parse.module.js` | 1 file | MIT (Don McCurdy) |
| zstddec | as shipped in three@0.185.1 `examples/jsm/libs/zstddec.module.js` | 1 file | MIT (Don McCurdy) |
| Basis Universal transcoder | as shipped in three@0.185.1 `examples/jsm/libs/basis/` | `basis_transcoder.js`, `.wasm` | Apache-2.0 (Binomial LLC; see `basis/README.md`) |
| three-mesh-bvh | 0.9.15 (npm `three-mesh-bvh@0.9.15`, published 2026-09-09; peer `three >= 0.159`) | `three-mesh-bvh/build/index.module.js` | MIT (`three-mesh-bvh/LICENSE`) |

The files were taken unmodified from the npm tarballs (`npm pack three@0.185.1 three-mesh-bvh@0.9.15`).
No 3DVista player code is included anywhere in `claude_v2s/web/`.

Dev-time only (not vendored, not needed at runtime): `gltfpack@1.3.0` (MIT, npm wasm build) for meshopt compression in
`claude_v2s/rundgang/web_dev_data.py compress`, and Playwright 1.58.0 (Apache-2.0) for `tests/headless_check.py`.

```
bbf5ed13fe4373f5bd38b14ea8e62e9f157327da5638edc6d3863e08b167c9c7  three/build/three.module.js
3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759  three/build/three.core.js
4a1f29ae93208d5f97a1652182c2d3133ce9cf51a6ffffc04f4d20255bf21afe  three-mesh-bvh/build/index.module.js
```
