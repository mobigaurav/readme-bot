/**
 * README scoping — given the list of changed files in a PR, decide which
 * README.md files might need an update and which subset of the diff is
 * relevant to each one.
 */
import type {ChangedFile} from './github.js';

export interface Scope {
  /** Path to the README.md to update (relative to repo root). */
  readmePath: string;
  /** Glob-style root that this README "owns". */
  root: string;
  /** Subset of changed files that fall under `root`. */
  files: ChangedFile[];
}

/**
 * Parse the user-supplied `scopes` input. The format is one rule per line
 * (or comma-separated):
 *
 *     backend/**            -> backend/README.md
 *     mobile/**             -> mobile/README.md
 *     .                     -> README.md
 *
 * If the right-hand side is omitted we default to `<dir>/README.md`.
 */
export function parseScopes(input: string): Array<{root: string; readmePath: string}> {
  const rules: Array<{root: string; readmePath: string}> = [];
  const lines = input
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
  for (const line of lines) {
    const [lhs, rhs] = line.split('->').map(s => s.trim());
    if (!lhs) continue;
    const root = stripGlob(lhs);
    const readmePath = rhs || joinPath(root, 'README.md');
    rules.push({root, readmePath});
  }
  return rules;
}

function stripGlob(s: string): string {
  // Drop trailing `/**`, `/*`, and stray slashes.
  return s.replace(/\/\*+$/, '').replace(/\/+$/, '') || '.';
}

function joinPath(dir: string, name: string): string {
  if (dir === '.' || dir === '') return name;
  return `${dir}/${name}`;
}

/**
 * Auto-discover scopes by inspecting the set of changed files for any path
 * containing `README.md`, plus the repo-root README.
 *
 * This is the fallback when the user doesn't pass an explicit `scopes` input.
 * For each unique directory containing a README.md (under the repo) we treat
 * that directory as the scope root.
 */
export function autoDiscoverScopes(
  changedFiles: ChangedFile[],
  knownReadmes: string[],
): Array<{root: string; readmePath: string}> {
  const rules: Array<{root: string; readmePath: string}> = [];
  for (const readme of knownReadmes) {
    const idx = readme.lastIndexOf('/');
    const root = idx < 0 ? '.' : readme.slice(0, idx);
    rules.push({root, readmePath: readme});
  }
  // Sort longest-prefix first so nested READMEs win over the root README.
  rules.sort((a, b) => b.root.length - a.root.length);
  // Reference the parameter to satisfy lint without changing semantics — we
  // may use it later to drop empty scopes early.
  void changedFiles;
  return rules;
}

export function bucketFilesByScope(
  changedFiles: ChangedFile[],
  rules: Array<{root: string; readmePath: string}>,
): Scope[] {
  const sorted = [...rules].sort((a, b) => b.root.length - a.root.length);
  const buckets = new Map<string, Scope>();
  for (const r of sorted) {
    buckets.set(r.readmePath, {readmePath: r.readmePath, root: r.root, files: []});
  }
  for (const f of changedFiles) {
    // Skip the README files themselves — we don't want a diff on the README
    // to look like new content the README needs to describe.
    if (f.filename.endsWith('/README.md') || f.filename === 'README.md') continue;
    for (const r of sorted) {
      if (matchesRoot(f.filename, r.root)) {
        buckets.get(r.readmePath)!.files.push(f);
        break;
      }
    }
  }
  return [...buckets.values()].filter(s => s.files.length > 0);
}

function matchesRoot(filename: string, root: string): boolean {
  if (root === '.' || root === '') return true;
  return filename === root || filename.startsWith(`${root}/`);
}

/**
 * Given a list of changed files, infer the set of README.md files that exist
 * in the repo by treating any *.md changes named README.md as known, plus a
 * repo-root README.md fallback. Callers can also pass an explicitly-known
 * list (e.g. from a previous `git ls-files` invocation).
 */
export function readmesFromChanges(changedFiles: ChangedFile[]): string[] {
  const set = new Set<string>(['README.md']);
  for (const f of changedFiles) {
    if (f.filename === 'README.md' || f.filename.endsWith('/README.md')) {
      set.add(f.filename);
    }
  }
  return [...set];
}
