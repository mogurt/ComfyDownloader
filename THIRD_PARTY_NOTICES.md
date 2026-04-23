# Third-party Notices

ComfyDownloader bundles or depends on the following third-party software.
Each component remains under its own license. This document is provided in
accordance with the redistribution terms of those licenses.

The ComfyDownloader source code itself is licensed under the MIT License
(see [`LICENSE`](LICENSE)). The notices below apply only to the bundled
or runtime-required third-party components.

---

## aria2

ComfyDownloader ships the [`aria2c`](https://github.com/aria2/aria2)
binary as a Tauri sidecar. The binary is downloaded at install time by
[`scripts/prepare-aria2.mjs`](scripts/prepare-aria2.mjs) and embedded into
release artifacts (`.dmg` / `.msi` / `.exe`).

- **Project**: aria2 — <https://aria2.github.io/>
- **Source code**: <https://github.com/aria2/aria2>
- **License**: GNU General Public License v2.0 or later (GPL-2.0-or-later)
- **License text**: <https://github.com/aria2/aria2/blob/master/COPYING>
- **Linkage**: aria2 runs as a separate process invoked over RPC. It is
  not statically or dynamically linked into ComfyDownloader's Rust or
  TypeScript code; ComfyDownloader and aria2 communicate only via
  aria2's JSON-RPC interface on a local loopback port.

If you redistribute the ComfyDownloader installers, you redistribute
the `aria2c` binary along with them and must continue to honor the
GPL-2.0-or-later terms for that binary, including providing access to
the corresponding aria2 source code (the upstream repository above
satisfies this requirement for unmodified builds).

---

## macOS aria2 builds (`AnInsomniacy/aria2-builder`)

On macOS, `prepare-aria2.mjs` downloads pre-built `aria2c` binaries from
the [`AnInsomniacy/aria2-builder`](https://github.com/AnInsomniacy/aria2-builder)
release feed. Those binaries are themselves builds of upstream aria2 and
remain under GPL-2.0-or-later as described above.

---

## Tauri runtime

This application is built on [Tauri](https://tauri.app/) v2.

- **License**: MIT OR Apache-2.0

---

## Other dependencies

Frontend (`package.json`) and Rust (`src-tauri/Cargo.toml`) dependencies
each retain their own licenses. The full dependency trees can be
inspected with:

```bash
npm ls --all
cargo tree --manifest-path src-tauri/Cargo.toml
```

If you spot a missing or inaccurate notice, please open an issue.
