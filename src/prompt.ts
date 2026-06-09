/**
 * Build the LLM prompt + post-process its output.
 */
import type {ChangedFile} from './github.js';

export interface PromptInput {
  readmePath: string;
  currentReadme: string | null;
  files: ChangedFile[];
  maxFiles: number;
  maxDiffBytes: number;
  prTitle: string;
  prBody: string;
}

export const SYSTEM_PROMPT = `You are a concise technical writer who maintains README files.

Your job is to look at a pull request and propose the smallest possible update
to a README.md so it accurately describes the project AFTER the PR lands.

Hard rules:
  1. Output ONLY the proposed full README content — no preamble, no fences,
     no commentary, no "Here is the updated README".
  2. Preserve the existing README's tone, heading style, badges, ToC and
     section order. Edit in place; do not rewrite from scratch.
  3. If the PR does not warrant any README change, output the SINGLE token
     NO_UPDATE on its own line and nothing else.
  4. Never invent features, versions, env vars, or commands that are not
     visible in the diff or the existing README.
  5. Keep additions tight: prefer one new bullet over a new paragraph.
`;

export function buildUserPrompt(input: PromptInput): string {
  const filesIncluded = input.files.slice(0, input.maxFiles);
  const truncatedFileCount = input.files.length - filesIncluded.length;

  const diffSections: string[] = [];
  let bytesUsed = 0;
  for (const f of filesIncluded) {
    const header = `--- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`;
    const patch = f.patch ?? '(binary or no patch available)';
    const block = `${header}\n${patch}\n`;
    if (bytesUsed + block.length > input.maxDiffBytes) {
      diffSections.push(`...(diff truncated at ${input.maxDiffBytes} bytes)...`);
      break;
    }
    diffSections.push(block);
    bytesUsed += block.length;
  }

  const currentSection =
    input.currentReadme === null
      ? '(README does not exist yet — propose an initial draft.)'
      : input.currentReadme;

  return [
    `# Pull request: ${input.prTitle}`,
    '',
    input.prBody.trim() || '(no description)',
    '',
    `# Target file: ${input.readmePath}`,
    '',
    '## Current contents',
    '',
    currentSection,
    '',
    '## Diff of code changes (relevant subset)',
    '',
    diffSections.join('\n'),
    truncatedFileCount > 0
      ? `\n(${truncatedFileCount} additional changed files were omitted to keep the prompt small.)`
      : '',
    '',
    '## Task',
    '',
    `Output the full updated contents of ${input.readmePath}, or the single`,
    'token NO_UPDATE if the PR does not require any README change.',
  ].join('\n');
}

/**
 * Parse the LLM output. Returns `null` to mean "no update needed".
 */
export function parseSuggestion(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Allow common LLM phrasings of "no change".
  if (/^NO[_-]?UPDATE\.?$/i.test(trimmed)) return null;
  // Strip a single fenced code block if the model insisted on one despite our
  // instructions — common with smaller models.
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return trimmed;
}
