# ComfyDownloader

A desktop application for downloading AI models to the correct ComfyUI directories, powered by aria2.

## Features

- **Smart URL parsing** - Automatically extracts filenames and metadata from Civitai, HuggingFace, and direct links
- **Model type recommendation** - Suggests the correct model type based on filename, URL, and source API metadata
- **Directory mapping** - Automatically routes downloads to the correct ComfyUI model subdirectory
- **aria2-powered downloads** - Concurrent, resumable downloads with real-time progress tracking
- **Duplicate detection** - Checks for existing files before downloading
- **Batch import** - Import multiple URLs at once from text or file
- **Custom rules** - Define keyword-based rules for automatic model type classification
- **Proxy support** - HTTP/SOCKS5 proxy for downloading behind firewalls
- **ComfyUI integration** - Verify models are recognized by a running ComfyUI instance

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui
- **Backend**: Tauri v2 (Rust)
- **Download Engine**: aria2c (embedded sidecar)
- **Database**: SQLite (via tauri-plugin-sql)
- **State Management**: Zustand

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.77
- Windows 10+ (macOS/Linux support planned)

## Development

```bash
# Install dependencies
npm install

# Manually prepare aria2c again if needed
npm run prepare:aria2

# Run in development mode (starts both Vite dev server and Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

On Windows x64, `npm install` automatically downloads the required `aria2c` sidecar into `src-tauri/binaries/`.

## Project Structure

```
src/                    # React frontend
  components/           # UI components
  pages/                # Home and Settings pages
  stores/               # Zustand state management
  hooks/                # Custom React hooks
  lib/                  # Types, API wrappers, utilities

src-tauri/              # Rust backend
  src/
    aria2/              # aria2 process management and RPC client
    commands/           # Tauri command handlers
    url_parser/         # URL parsing for Civitai, HuggingFace, etc.
    model_type/         # Model type recommendation engine
    db/                 # SQLite migrations
  binaries/             # aria2c sidecar binary
```

