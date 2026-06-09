/**
 * readme-bot — GitHub Action entrypoint.
 *
 * Reads the PR diff, asks an LLM to propose an updated README per scope,
 * and posts (or updates) a single comment with the suggested diff.
 */
import * as core from '@actions/core';
import {context, getOctokit} from '@actions/github';

import {
  listChangedFiles,
  getFileAtRef,
  upsertComment,
  type ChangedFile,
  type PullRequestRef,
} from './github.js';
import {
  parseScopes,
  autoDiscoverScopes,
  bucketFilesByScope,
  readmesFromChanges,
  type Scope,
} from './readme.js';
import {buildUserPrompt, parseSuggestion, SYSTEM_PROMPT} from './prompt.js';
import {complete, isProvider, resolveModel, type ProviderId} from './providers.js';
import {unifiedDiff} from './diff.js';

interface Inputs {
  token: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
  scopesRaw: string;
  maxFiles: number;
  maxDiffBytes: number;
  commentMarker: string;
  dryRun: boolean;
  failOnError: boolean;
}

function readInputs(): Inputs {
  const provider = core.getInput('provider', {required: false}).toLowerCase() || 'github-models';
  if (!isProvider(provider)) {
    throw new Error(
      `Unsupported provider "${provider}". Use github-models | openai | anthropic | gemini.`,
    );
  }
  const token = core.getInput('github-token', {required: true});
  const explicitKey = core.getInput('api-key');
  // For GitHub Models we can fall back to GITHUB_TOKEN — the workflow only
  // needs `models: read` permission. Other providers must supply their own key.
  const apiKey =
    explicitKey ||
    (provider === 'github-models' ? token : '');
  if (!apiKey) {
    throw new Error(
      `Missing api-key for provider "${provider}". Pass an API key via the \`api-key\` input.`,
    );
  }
  return {
    token,
    provider,
    apiKey,
    model: core.getInput('model'),
    scopesRaw: core.getInput('scopes'),
    maxFiles: Number.parseInt(core.getInput('max-files') || '40', 10),
    maxDiffBytes: Number.parseInt(core.getInput('max-diff-bytes') || '40000', 10),
    commentMarker: core.getInput('comment-marker') || '<!-- readme-bot:comment -->',
    dryRun: core.getInput('dry-run') === 'true',
    failOnError: core.getInput('fail-on-error') === 'true',
  };
}

async function main(): Promise<void> {
  const inputs = readInputs();

  if (!context.payload.pull_request) {
    core.info('No pull_request payload — skipping (run readme-bot on `pull_request` events).');
    core.setOutput('suggestions-count', '0');
    return;
  }

  const pr: PullRequestRef = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    number: context.payload.pull_request.number,
  };
  const headRef = context.payload.pull_request.head?.sha as string;
  const baseRef = context.payload.pull_request.base?.sha as string;
  const prTitle = (context.payload.pull_request.title as string) ?? '';
  const prBody = (context.payload.pull_request.body as string) ?? '';

  const octokit = getOctokit(inputs.token);

  core.info(`Fetching changed files for PR #${pr.number}…`);
  const changedFiles = await listChangedFiles(octokit, pr);
  core.info(`PR touches ${changedFiles.length} files.`);

  // Decide scope rules.
  const explicitRules = parseScopes(inputs.scopesRaw);
  const rules =
    explicitRules.length > 0
      ? explicitRules
      : autoDiscoverScopes(changedFiles, readmesFromChanges(changedFiles));
  core.info(
    `Using ${rules.length} scope rule(s): ${rules.map(r => `${r.root} -> ${r.readmePath}`).join(', ')}`,
  );

  const scopes = bucketFilesByScope(changedFiles, rules);
  if (scopes.length === 0) {
    core.info('No scope had matching changed files — nothing to suggest.');
    core.setOutput('suggestions-count', '0');
    return;
  }

  const model = resolveModel(inputs.provider, inputs.model);
  core.info(`Using ${inputs.provider} / ${model}.`);

  const sections: string[] = [];
  let suggestionsCount = 0;

  for (const scope of scopes) {
    try {
      const section = await processScope({
        scope,
        baseRef,
        headRef,
        prTitle,
        prBody,
        inputs,
        model,
        octokit,
        pr,
      });
      if (section) {
        sections.push(section);
        suggestionsCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.warning(`Scope ${scope.readmePath} failed: ${msg}`);
      if (inputs.failOnError) throw err;
    }
  }

  core.setOutput('suggestions-count', String(suggestionsCount));

  if (sections.length === 0) {
    core.info('No README updates suggested — skipping comment.');
    return;
  }

  const body = renderCommentBody(inputs.commentMarker, sections, inputs.provider, model);

  if (inputs.dryRun) {
    core.info('--- DRY RUN: comment body would be ---\n' + body);
    return;
  }

  await upsertComment(octokit, pr, inputs.commentMarker, body);
  core.info(`Posted README suggestions for ${suggestionsCount} file(s).`);
}

interface ProcessArgs {
  scope: Scope;
  baseRef: string;
  headRef: string;
  prTitle: string;
  prBody: string;
  inputs: Inputs;
  model: string;
  octokit: ReturnType<typeof getOctokit>;
  pr: PullRequestRef;
}

async function processScope(args: ProcessArgs): Promise<string | null> {
  const {scope, headRef, baseRef, octokit, pr, inputs, model, prTitle, prBody} = args;

  // Pull current README from the head ref so we propose a diff against the
  // PR's own state, not main. Falls back to base if the file was deleted on
  // head, then to null (treat as "create").
  const currentReadme =
    (await getFileAtRef(octokit, pr, scope.readmePath, headRef)) ??
    (await getFileAtRef(octokit, pr, scope.readmePath, baseRef));

  const userPrompt = buildUserPrompt({
    readmePath: scope.readmePath,
    currentReadme,
    files: scope.files,
    maxFiles: inputs.maxFiles,
    maxDiffBytes: inputs.maxDiffBytes,
    prTitle,
    prBody,
  });

  core.info(`Asking ${inputs.provider} for ${scope.readmePath} (${scope.files.length} files)…`);
  const completion = await complete(inputs.provider, inputs.apiKey, {
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model,
    maxTokens: 4096,
  });

  const suggested = parseSuggestion(completion.text);
  if (suggested === null) {
    core.info(`  → ${scope.readmePath}: model says NO_UPDATE.`);
    return null;
  }

  if (currentReadme !== null && suggested.trim() === currentReadme.trim()) {
    core.info(`  → ${scope.readmePath}: model returned identical content, skipping.`);
    return null;
  }

  const diff = unifiedDiff(
    currentReadme ?? '',
    suggested,
    `a/${scope.readmePath}`,
    `b/${scope.readmePath}`,
  );

  return renderScopeSection(scope, currentReadme === null, diff, suggested);
}

function renderScopeSection(
  scope: Scope,
  isNewFile: boolean,
  diff: string,
  fullContent: string,
): string {
  const filesList = scope.files
    .slice(0, 10)
    .map(f => `\`${f.filename}\``)
    .join(', ');
  const more = scope.files.length > 10 ? ` _(+${scope.files.length - 10} more)_` : '';

  const heading = isNewFile
    ? `### 🆕 New file suggested: \`${scope.readmePath}\``
    : `### ✏️ Suggested updates to \`${scope.readmePath}\``;

  return [
    heading,
    '',
    `Triggered by changes in: ${filesList}${more}`,
    '',
    '<details><summary>Suggested diff</summary>',
    '',
    '```diff',
    diff || '(no textual diff — see full suggestion below)',
    '```',
    '',
    '</details>',
    '',
    '<details><summary>Full proposed contents</summary>',
    '',
    '````markdown',
    fullContent,
    '````',
    '',
    '</details>',
  ].join('\n');
}

function renderCommentBody(
  marker: string,
  sections: string[],
  provider: string,
  model: string,
): string {
  return [
    marker,
    '## 📚 README Bot — suggested updates',
    '',
    'I noticed code changes in this PR that may need matching README updates.',
    'Review the suggestions below and apply whatever you find useful.',
    '',
    ...sections,
    '',
    '---',
    `_Generated with **${provider}** (\`${model}\`). ` +
      `Powered by [readme-bot](https://github.com/mobigaurav/readme-bot)._`,
  ].join('\n');
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  if (core.getInput('fail-on-error') === 'true') {
    core.setFailed(msg);
  } else {
    core.warning(`readme-bot soft-failed: ${msg}`);
    core.setOutput('suggestions-count', '0');
  }
});
