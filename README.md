# 📚 README Bot

> **Auto-suggest README updates on every pull request — powered by the LLM of your choice.**

A GitHub Action that watches your pull requests, figures out which `README.md`
files might be out of date, and posts a suggested diff as a PR comment — using
**your** preferred LLM (GitHub Models by default, with OpenAI, Anthropic, or
Gemini as alternatives).

It is **non-invasive**: the bot never pushes commits to your branch. It just
leaves a comment with a proposed diff and the full updated content. You decide
whether to apply it.

---

## Why

Most projects' README slowly drifts away from the code:

- A new env var is added, but the *Configuration* section never mentions it.
- A subdirectory grows a feature module, but the *Architecture* section is stale.
- A new endpoint ships, but the *API* table doesn't list it.

`readme-bot` reads the PR diff plus the current README, asks an LLM for the
**smallest possible update** that keeps the README accurate, and shows you the
result.

## Features

- 🤖 **Zero-config on GitHub Enterprise / Copilot.** Defaults to
  [GitHub Models](https://docs.github.com/en/github-models) using the
  workflow's built-in `GITHUB_TOKEN` — no third-party API key required.
- 🔌 **Bring-your-own LLM.** Switch to OpenAI, Anthropic, or Gemini with
  a single input.
- 🗂 **Per-directory READMEs.** Configure scopes so `mobile/` changes update
  `mobile/README.md`, `backend/` changes update `backend/README.md`, etc.
- 🔁 **Idempotent comments.** The bot edits its previous comment in place
  using a hidden HTML marker — no comment spam on every push.
- 🧮 **Diff truncation.** Big PRs are clipped to a configurable byte budget
  so prompts stay cheap.
- 🛟 **Soft fail.** Unless you opt in, an LLM hiccup or rate limit just warns
  and exits 0; your CI is never blocked.
- 📦 **Zero vendor SDKs at runtime.** Native `fetch` only — the published
  bundle is small and audit-friendly.

## Quick start

### Option A — GitHub Models (default, no API key)

```yaml
# .github/workflows/readme-bot.yml
name: README Bot

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  models: read          # required for GitHub Models

jobs:
  suggest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mobigaurav/readme-bot@v1
        # No api-key needed — GITHUB_TOKEN is used automatically.
```

### Option B — Bring your own provider

```yaml
      - uses: mobigaurav/readme-bot@v1
        with:
          provider: openai
          api-key: ${{ secrets.OPENAI_API_KEY }}
```

That's it. Open a PR, get a suggestion comment.

## Inputs

| Input             | Required | Default                            | Description                                                              |
| ----------------- | -------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `github-token`    | no       | `${{ github.token }}`              | Token used to read the PR diff and post a comment. Also used as the API key when `provider: github-models`. |
| `provider`        | no       | `github-models`                    | One of `github-models`, `openai`, `anthropic`, `gemini`.                 |
| `api-key`         | depends  | `""`                               | API key for the chosen provider. **Optional for `github-models`** (falls back to `github-token`). Required for the other three. |
| `model`           | no       | provider default                   | Override the default model. See defaults below.                          |
| `scopes`          | no       | _(auto-discover)_                  | Newline- or comma-separated `<glob> -> <readme path>` rules.             |
| `max-files`       | no       | `40`                               | Maximum changed files to include in the prompt per scope.                |
| `max-diff-bytes`  | no       | `40000`                            | Byte cap on the diff payload sent to the LLM.                            |
| `comment-marker`  | no       | `<!-- readme-bot:comment -->`      | Hidden marker used to locate and update the previous comment.            |
| `dry-run`         | no       | `false`                            | If `true`, log the suggestion to the workflow log instead of commenting. |
| `fail-on-error`   | no       | `false`                            | If `true`, fail the job on errors instead of soft-warning.               |

### Default models

| Provider         | Default model                  |
| ---------------- | ------------------------------ |
| `github-models`  | `openai/gpt-4o-mini`           |
| `openai`         | `gpt-4o-mini`                  |
| `anthropic`      | `claude-3-5-sonnet-latest`    |
| `gemini`         | `gemini-1.5-pro`               |

## Outputs

| Output              | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `suggestions-count` | Number of READMEs the bot proposed updates for in this run.       |

## Scopes

`scopes` lets you tell the bot which README "owns" which subtree of the repo,
so a backend-only PR updates `backend/README.md` and not the project-root
README.

```yaml
with:
  scopes: |
    backend/**   -> backend/README.md
    mobile/**    -> mobile/README.md
    frontend/**  -> frontend/README.md
    .            -> README.md
```

If you don't pass `scopes`, the bot auto-discovers every `README.md` it can
find in the changed-file set (plus the repo-root README) and treats each
containing directory as that README's scope, longest-prefix-wins.

## Provider notes

### GitHub Models (default — recommended for Enterprise / Copilot users)

Uses the [GitHub Models](https://docs.github.com/en/github-models) inference
endpoint, which is included with GitHub Free and **bundled with GitHub
Enterprise / Copilot subscriptions**. Authenticated via the workflow's
built-in `GITHUB_TOKEN` — no third-party signup, no per-call billing on
your OpenAI account, no key rotation.

```yaml
permissions:
  contents: read
  pull-requests: write
  models: read           # <-- required

steps:
  - uses: actions/checkout@v4
  - uses: mobigaurav/readme-bot@v1
    with:
      provider: github-models     # the default; can be omitted
      model: openai/gpt-4o        # optional override
```

Model IDs use `<publisher>/<model>` form. Common picks:
`openai/gpt-4o-mini`, `openai/gpt-4o`, `meta/Meta-Llama-3.1-70B-Instruct`,
`mistral-ai/Mistral-Large-2411`. Browse the catalog at
<https://github.com/marketplace/models>.

### OpenAI

```yaml
with:
  provider: openai
  api-key: ${{ secrets.OPENAI_API_KEY }}
  model: gpt-4o-mini  # or gpt-4o, o3-mini, etc.
```

### Anthropic

```yaml
with:
  provider: anthropic
  api-key: ${{ secrets.ANTHROPIC_API_KEY }}
  model: claude-3-5-sonnet-latest
```

### Google Gemini

```yaml
with:
  provider: gemini
  api-key: ${{ secrets.GEMINI_API_KEY }}
  model: gemini-1.5-pro
```

## Permissions

The workflow that calls this action needs:

```yaml
permissions:
  contents: read         # to read the PR diff and current README
  pull-requests: write   # to post / update the suggestion comment
```

If your repo defaults to read-only `GITHUB_TOKEN` for forks (recommended),
the comment will be skipped automatically for fork PRs since the bot has no
write permission. To support forks safely, run on `pull_request_target`
instead and gate carefully — see GitHub's
[security docs](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions).

## Privacy

The action sends the PR diff (capped at `max-diff-bytes`) and the current
README to your chosen LLM provider. **No code or credentials are sent to
any other service.** The action itself uses native `fetch` over HTTPS — no
vendor SDKs, no telemetry.

When `provider: github-models` is used, requests stay inside GitHub's
infrastructure — handy for enterprises that already have a data-handling
agreement with GitHub.

## Installing in a private / enterprise repo

You have three options:

1. **Reference the published action** (simplest, once `readme-bot` is on a
   repo you control):

   ```yaml
   - uses: mobigaurav/readme-bot@v1
   ```

   Works for any repo \— public or private \— as long as the workflow's
   GitHub host can reach `github.com`. On GitHub Enterprise Server, mirror
   the action repo onto your GHES instance and reference it as
   `uses: your-ghes-org/readme-bot@v1`.

2. **Vendor the action** by copying the `tools/readme-bot/` folder into the
   target repo and using a relative path:

   ```yaml
   - uses: ./tools/readme-bot
   ```

   This is the right choice when the target org doesn't allow third-party
   actions or when you want to pin a known-good build.

3. **Re-package as a Docker action** if you need a hermetic runtime — the
   bundled `dist/index.js` already runs on `node20`, so wrapping in a
   Dockerfile is straightforward.

## Development

```bash
cd tools/readme-bot
npm install
npm run build         # produces dist/index.js (committed for the Action runtime)
npm run lint          # tsc --noEmit
```

To test locally against a real PR, install [`act`](https://github.com/nektos/act)
and pipe the workflow with the relevant secrets:

```bash
act pull_request -s OPENAI_API_KEY=sk-...
```

## Roadmap

- [ ] `mode: auto-commit` — push the suggestion to the PR branch.
- [ ] `mode: post-merge-pr` — open a follow-up PR after merge.
- [ ] Inline suggestions via the [PR Review API](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request) for surgical edits.
- [ ] Self-hosted / Ollama support for fully offline runs.
- [ ] Caching by `(file_set_hash, README_hash)` to skip identical re-runs.

## License

MIT — see [LICENSE](./LICENSE).
