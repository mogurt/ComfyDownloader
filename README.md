# ComfyDownloader

[简体中文](README.zh-CN.md)

A desktop application for downloading AI models to the correct ComfyUI directories, powered by aria2.

[![CI](https://github.com/mogurt/ComfyDownloader/actions/workflows/ci.yml/badge.svg)](https://github.com/mogurt/ComfyDownloader/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mogurt/ComfyDownloader)](https://github.com/mogurt/ComfyDownloader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why This Project

ComfyDownloader is built for the annoying part of the ComfyUI workflow: finding a model, figuring out what type it is, choosing the correct subdirectory, and downloading it reliably.

Instead of juggling browser tabs, model pages, and manual folder selection, the app focuses on a tighter flow:

- Search models from Hugging Face and Civitai in one desktop app
- Parse URLs and suggest the correct ComfyUI model type
- Route downloads into the right model directory
- Track resumable downloads with aria2
- Inspect workflow files to see which models are missing locally

## Screenshots

### Search

![Search and source browsing](docs/screenshots/search.png)

### Downloads

![Download queue and progress tracking](docs/screenshots/downloads.png)

### Workflow

![Workflow model dependency analysis](docs/screenshots/workflow.png)

### Settings

![Directory mapping and token settings](docs/screenshots/settings.png)

## Features

- **Smart URL parsing** - Automatically extracts filenames and metadata from Civitai, Hugging Face, and direct links
- **Model type recommendation** - Suggests the correct model type based on filename, URL, and source API metadata
- **Directory mapping** - Automatically routes downloads to the correct ComfyUI model subdirectory
- **aria2-powered downloads** - Concurrent, resumable downloads with real-time progress tracking
- **Duplicate detection** - Checks for existing files before downloading
- **Batch import** - Import multiple URLs at once from text or file
- **Custom rules** - Define keyword-based rules for automatic model type classification
- **Proxy support** - HTTP/SOCKS5 proxy for downloading behind firewalls
- **ComfyUI integration** - Verify models are recognized by a running ComfyUI instance
- **Workflow parser** - Analyze ComfyUI workflow JSON and check which models are missing locally

## Quick Start

1. Download the latest build from [Releases](https://github.com/mogurt/ComfyDownloader/releases).
2. Open the app and configure your `ComfyUI root` or `model base directory`.
3. Paste a model URL or search from Hugging Face / Civitai.
4. Confirm the suggested model type and target directory.
5. Start the download and track progress from the Downloads page.

## Platform Support

Pre-built binaries are currently published for:

- macOS (Apple Silicon, `aarch64`) - `.dmg`
- macOS (Intel, `x86_64`) - `.dmg`
- Windows (`x86_64`) - `.msi` / `.exe`

Linux packaging is planned, but it is not officially supported yet.

Each release also ships a `SHA256SUMS.txt` file for artifact verification.

> These builds are **not code-signed** yet. See [First-time launch on macOS / Windows](#first-time-launch-on-macos--windows).

### Verifying the download (SHA256)

```bash
# macOS / Linux
shasum -a 256 ComfyDownloader_*.dmg

# Windows (PowerShell)
Get-FileHash .\ComfyDownloader_*.msi -Algorithm SHA256
```

Compare the output against the matching line in `SHA256SUMS.txt`.

### First-time launch on macOS / Windows

Because the project does not yet use Apple Developer ID signing or a Windows EV certificate, the OS may warn you on first launch. The binaries are built from this repository by GitHub Actions, and you can inspect the workflow in [`release.yml`](.github/workflows/release.yml).

**macOS** - If you see _"ComfyDownloader is damaged and can't be opened"_ or _"Apple cannot check it for malicious software"_, this is usually Gatekeeper blocking an unsigned app, not a corrupted DMG.

1. Drag `ComfyDownloader.app` into `Applications`
2. Run:

```bash
xattr -dr com.apple.quarantine /Applications/ComfyDownloader.app
```

3. Open the app again

You can also right-click the app and choose **Open**.

**Windows** - If SmartScreen shows _"Windows protected your PC"_, click **More info** -> **Run anyway**.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui
- **Backend**: Tauri v2 (Rust)
- **Download Engine**: aria2c (embedded sidecar)
- **Database**: SQLite via `tauri-plugin-sql`
- **State Management**: Zustand

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://rustup.rs/) >= 1.77
- Windows 10+ or macOS

### Local setup

```bash
# Install dependencies
npm install

# Re-download aria2c if needed
npm run prepare:aria2

# Start Vite + Tauri
npm run tauri dev

# Build production app
npm run tauri build
```

`npm install` automatically downloads the required `aria2c` sidecar into `src-tauri/binaries/` for supported Windows and macOS targets.

Useful checks:

```bash
npm run lint
npm run typecheck
cd src-tauri && cargo test
```

## Security Notes

- Hugging Face and Civitai access tokens are currently stored in the local SQLite settings database. Avoid reusing highly privileged tokens.
- Releases are not code-signed yet. Verify checksums before first launch.
- For security-sensitive reports, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue.

## Project Structure

```text
src/                    # React frontend
  components/           # UI components
  pages/                # Downloads, Search, Workflow, Settings
  stores/               # Zustand state management
  hooks/                # Custom React hooks
  lib/                  # Types, API wrappers, utilities

src-tauri/              # Rust backend
  src/
    aria2/              # aria2 process management and RPC client
    commands/           # Tauri command handlers
    url_parser/         # URL parsing for Civitai, Hugging Face, etc.
    model_type/         # Model type recommendation engine
    db/                 # SQLite migrations
  binaries/             # aria2c sidecar binary
```

## Roadmap

- Improve release polish for public users
- Expand workflow parsing coverage for more ComfyUI node patterns
- Improve token handling and local secret storage
- Add official Linux packaging support
- Add richer screenshots and onboarding docs

## Contributing

Contributions are welcome, including bug fixes, workflow parser improvements, and i18n updates.

- Start from the `dev` branch for normal contribution work
- Conventional Commits are preferred (`feat:`, `fix:`, `docs:`, `chore:`)
- Opening an issue first is optional for straightforward fixes

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for more details.
