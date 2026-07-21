# Contributing

Thanks for helping improve Realtime Subtitle Translator.

## Before you start

- Use Node.js 22.13 or newer and a Chromium-based browser.
- Search existing issues before opening a new one.
- Open an issue before a large feature or architecture change.
- Report security vulnerabilities through the private process in `SECURITY.md`.

## Development setup

```bash
git clone https://github.com/haru3613/realtime-subtitle-translator.git
cd realtime-subtitle-translator
npm ci
npm test
npm run typecheck
npm run build
```

Load `.output/chrome-mv3` from `chrome://extensions` for manual browser testing.
Use `npm run dev` and load `.output/chrome-mv3-dev` for the watch build.

## Pull requests

1. Branch from `staging` using a focused name such as `fix/live-caption-gap`.
2. Keep each pull request to one change and avoid unrelated cleanup.
3. Add or update the smallest relevant test for behavior changes.
4. Run `npm test`, `npm run typecheck`, and `npm run build`.
5. Describe what changed, why, and how you verified it.

Commit messages should use a short conventional prefix such as `feat:`, `fix:`,
`docs:`, `test:`, or `chore:`.

By submitting a contribution, you agree that it may be distributed under the
MIT License.
