# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-09

### Added
- Initial public release of README Bot.
- GitHub Action that posts a suggested README diff as a comment on every pull
  request, scoped to the README that owns each touched subtree.
- **`github-models` provider** (default) — uses the workflow's built-in
  `GITHUB_TOKEN` with `models: read` permission. Zero-config on GitHub Free,
  Pro, Enterprise Cloud, and any account with a Copilot subscription.
- **`openai` provider** — bring-your-own OpenAI API key.
- **`anthropic` provider** — bring-your-own Anthropic API key.
- **`gemini` provider** — bring-your-own Google AI Studio (Gemini) API key.
- Per-directory README scoping via simple glob rules
  (`backend/** -> backend/README.md` etc.).
- Idempotent comment updates via a hidden HTML marker so the bot edits its
  previous comment in place instead of spamming the PR.
- Diff truncation (`max-files`, `max-diff-bytes`) to keep prompts cheap.
- `dry-run` and `fail-on-error` knobs for safe rollout in protected
  pipelines.
- Self-contained Myers-LCS unified diff renderer; no `diff` package
  dependency.
- Single ~566 KB bundled `dist/index.js` with no vendor SDKs at runtime —
  native `fetch` only.

[Unreleased]: https://github.com/mobigaurav/readme-bot/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mobigaurav/readme-bot/releases/tag/v1.0.0
