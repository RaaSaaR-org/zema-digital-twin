# Vendored third-party code (no build step; loaded through the import map in ../index.html)

| package | version (exact) | files | licence |
|---|---|---|---|
| three.js | 0.185.1 (r185, npm `three@0.185.1`, published 2025-07-01) | `three/build/three.module.js`, `three/build/three.core.js`, `three/examples/jsm/{loaders/GLTFLoader.js, loaders/KTX2Loader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js, utils/WorkerPool.js, math/ColorSpaces.js}` | MIT (`three/LICENSE`) |
| meshoptimizer decoder | as shipped in three@0.185.1 `examples/jsm/libs/meshopt_decoder.module.js` | 1 file | MIT (header of the file, (c) Arseny Kapoulkine) |
| ktx-parse | as shipped in three@0.185.1 `examples/jsm/libs/ktx-parse.module.js` | 1 file | MIT (Don McCurdy) |
| zstddec | as shipped in three@0.185.1 `examples/jsm/libs/zstddec.module.js` | 1 file | MIT (Don McCurdy) |
| Basis Universal transcoder | as shipped in three@0.185.1 `examples/jsm/libs/basis/` | `basis_transcoder.js`, `.wasm` | Apache-2.0 (Binomial LLC; see `basis/README.md`) |
| **Spark** (`@sparkjsdev/spark`, v3 splat layer) | **2.3.1** (npm, published 2026-10-01; 2.4.0 of 2026-10-20 deliberately not used: < 2 weeks old; peer `three >= 0.180.0`) | `spark/dist/spark.module.min.js` (ES module, imported lazily by `js/splats.js` only when the splat layer is switched on), `spark/LICENSE`, `spark/package.json` | MIT, (c) 2025 World Labs Technologies, Inc. (`spark/LICENSE`, copy in `LICENSES/spark-MIT.txt`) |
| fflate (bundled inside Spark) | as bundled in spark@2.3.1 (`node_modules/fflate/esm/browser.js` region; Spark's devDependency `^0.8.2`) | inside `spark.module.min.js` | MIT, (c) 2023 Arjun Barrett (`LICENSES/fflate-MIT.txt`, from the npm tarball `fflate@0.8.2`) |
| spark-rs WebAssembly (bundled inside Spark) | as bundled in spark@2.3.1 (base64 wasm in the module; the `rust/` workspace of the Spark repo at tag v2.3.1, licence MIT) | inside `spark.module.min.js` | MIT (Spark workspace). Its compiled Rust crate dependencies (`rust/Cargo.toml` at v2.3.1: ahash, anyhow, glam, half, itertools, js-sys, miniz_oxide, ordered-float, serde, serde_json, serde-wasm-bindgen, smallvec, wasm-bindgen, web-sys, zip, image, hnsw, rand_pcg, space, console_error_panic_hook) are each published under MIT and/or Apache-2.0 (miniz_oxide: MIT / Zlib / Apache-2.0); the Apache-2.0 text is `LICENSES/Apache-2.0.txt` |
| three.js post-processing `Pass.js` (needed by Spark: `three/addons/postprocessing/Pass.js`) | 0.185.1 (same npm tarball as the other three files) | `three/examples/jsm/postprocessing/Pass.js` | MIT (`three/LICENSE`) |
| three-mesh-bvh | 0.9.15 (npm `three-mesh-bvh@0.9.15`, published 2026-09-09; peer `three >= 0.159`) | `three-mesh-bvh/build/index.module.js` | MIT (`three-mesh-bvh/LICENSE`) |

The files were taken unmodified from the npm tarballs (`npm pack three@0.185.1 three-mesh-bvh@0.9.15`).
v3 additions (2026-10-23): downloaded from the npm registry and checked against the registry's
`dist.integrity`:

| tarball | sha512 integrity (registry = download) | sha256 of the tarball |
|---|---|---|
| `https://registry.npmjs.org/@sparkjsdev/spark/-/spark-2.3.1.tgz` | `sha512-K+SyIbkO/dx1TLLudK8Jp3/noS13z/kdNPo6OK2waxQaGy81HBmKGnNBT/t/K9Ew3dsIXmWqsJXxGfmAu1T5Jg==` | `63b7ee3c9e253f43071ba50c74d2fcd3768852ef4dcf3c75e1983af70263bd5b` |
| `https://registry.npmjs.org/three/-/three-0.185.1.tgz` (only `Pass.js` added) | `sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==` | `a2143f5bf978bd3470a51024b2b6bdd581913ba8f36ff1538d433f3a95adf2df` |
| `https://registry.npmjs.org/fflate/-/fflate-0.8.2.tgz` (only its `LICENSE` text) | `sha512-cPJU47OaAoCbg0pBvzsgpTPhmhqI5eJjh/JIu8tPj5q+T7iLvW/JAYUqmE7KOB4R1ZyEhzBaIQpQpardBF5z8A==` | `61fd5061e2fc8e5e3e3129f7f2fec7bd78a313e1bf4becbf1cc1cc9998d141dc` |

`spark.module.min.js` ends with a `//# sourceMappingURL=spark.module.min.js.map` comment; the map is not shipped (browsers
only request it with the developer tools open). Spark's workers and its wasm are inlined in the module (data URLs), so
no other Spark file is fetched at runtime.
No 3DVista player code is included in this site.

Dev-time only (not vendored, not needed at runtime): `gltfpack@1.3.0` (MIT, npm wasm build) for meshopt compression, and Playwright 1.58.0
(Apache-2.0) for the headless browser checks.

```
bbf5ed13fe4373f5bd38b14ea8e62e9f157327da5638edc6d3863e08b167c9c7  three/build/three.module.js
3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759  three/build/three.core.js
4a1f29ae93208d5f97a1652182c2d3133ce9cf51a6ffffc04f4d20255bf21afe  three-mesh-bvh/build/index.module.js
2d65ef810f06be91a31a6b617d170ce0f46b54be6e973a36f5ae810fb952f2a6  spark/dist/spark.module.min.js
51829693e5dccd9ca1daa093991faac3aaa93238eb8fd5f5cb4130af85791d64  spark/LICENSE
376a8ca629e1cd1c65b69a9ec9356ab9caafa2f4adad95afe74ae3a4316a612c  spark/package.json
444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5  three/examples/jsm/postprocessing/Pass.js
```
