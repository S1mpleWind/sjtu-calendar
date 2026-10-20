# Third-party notices

Direct runtime dependencies are listed below. Their full resolved dependency graphs are pinned in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`; consult the license text included with each package for transitive notices.

## Runtime dependencies

| Package | Resolved version | License |
|---|---:|---|
| Tauri (`tauri`) | 2.12.4 | Apache-2.0 OR MIT |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT |
| React / React DOM | 19.3.1 | MIT |
| `rusqlite` | 0.38.0 | MIT |
| `serde` / `serde_json` | 1.0.229 / 1.0.154 | MIT OR Apache-2.0 |
| `chrono` / `chrono-tz` | 0.4.45 / 0.10.4 | MIT OR Apache-2.0 |
| `reqwest` | 0.12.28 | MIT OR Apache-2.0 |
| `keyring` | 4.2.0 | MIT OR Apache-2.0 |
| `rrule` | 0.14.0 | MIT OR Apache-2.0 |
| `uuid` | 1.28.0 | Apache-2.0 OR MIT |
| `regex` | 1.13.1 | MIT OR Apache-2.0 |
| `base64` / `sha2` | 0.22.1 / 0.10.9 | MIT OR Apache-2.0 |

Development-only dependencies include Vite, TypeScript, ESLint, Vitest, Testing Library, `tempfile` and Tokio. Their package manifests and licenses are in the respective lockfiles/registries.

The SQLite amalgamation bundled by `rusqlite` is in the public domain. SJTU-Course-Block was inspected as an ignored, read-only reference and its code was not copied; no license file was found in the inspected revision. SJTU-Canvas-Helper is MIT-licensed and no source code was copied from it.
