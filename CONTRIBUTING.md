# Contributing

Thanks for contributing to ComfyDownloader.

## Workflow

- Use `dev` as the default branch for day-to-day contribution work.
- Keep pull requests focused and small when possible.
- Linking an issue is welcome, but not required for straightforward fixes.

## Development Setup

```bash
npm install
npm run tauri dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test
```

## Commit Style

Conventional Commits are preferred:

- `feat:`
- `fix:`
- `docs:`
- `chore:`
- `refactor:`
- `test:`

## Pull Requests

- Describe the user-visible impact.
- Mention any platform-specific behavior if relevant.
- Include screenshots for UI changes when possible.
- Update docs when behavior or setup changes.

## Translations

i18n contributions are welcome. If you add or update UI text, please keep English and Chinese entries in sync where possible.

## Security

Please do not open public issues for security-sensitive reports. Follow the process in [`SECURITY.md`](SECURITY.md) instead.
