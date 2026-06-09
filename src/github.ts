/**
 * GitHub helpers — thin wrappers over Octokit for the bits we actually use.
 */
import {getOctokit} from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  patch?: string;
}

export async function listChangedFiles(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<ChangedFile[]> {
  const out: ChangedFile[] = [];
  // Paginate — GitHub returns at most 100 per page; PRs occasionally have
  // hundreds of files (lockfile churn etc.) so we follow `next` links.
  for (let page = 1; page <= 30; page++) {
    const res = await octokit.rest.pulls.listFiles({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      per_page: 100,
      page,
    });
    if (res.data.length === 0) break;
    for (const f of res.data) {
      out.push({
        filename: f.filename,
        status: f.status as ChangedFile['status'],
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      });
    }
    if (res.data.length < 100) break;
  }
  return out;
}

/**
 * Read a file at a given ref. Returns `null` if the file does not exist
 * (e.g. README.md is being created for the first time).
 */
export async function getFileAtRef(
  octokit: Octokit,
  pr: PullRequestRef,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner: pr.owner,
      repo: pr.repo,
      path,
      ref,
    });
    // The endpoint returns either a file object or a directory listing.
    if (Array.isArray(res.data) || res.data.type !== 'file') return null;
    if ('content' in res.data && typeof res.data.content === 'string') {
      return Buffer.from(res.data.content, res.data.encoding as BufferEncoding).toString('utf8');
    }
    return null;
  } catch (err: unknown) {
    if ((err as {status?: number}).status === 404) return null;
    throw err;
  }
}

export interface CommentMatch {
  id: number;
  body: string;
}

/** Find a previous comment by hidden marker so we can update in place. */
export async function findExistingComment(
  octokit: Octokit,
  pr: PullRequestRef,
  marker: string,
): Promise<CommentMatch | null> {
  for (let page = 1; page <= 10; page++) {
    const res = await octokit.rest.issues.listComments({
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.number,
      per_page: 100,
      page,
    });
    for (const c of res.data) {
      if (c.body && c.body.includes(marker)) {
        return {id: c.id, body: c.body};
      }
    }
    if (res.data.length < 100) break;
  }
  return null;
}

export async function upsertComment(
  octokit: Octokit,
  pr: PullRequestRef,
  marker: string,
  body: string,
): Promise<void> {
  const existing = await findExistingComment(octokit, pr, marker);
  const fullBody = body.includes(marker) ? body : `${marker}\n${body}`;
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: pr.owner,
      repo: pr.repo,
      comment_id: existing.id,
      body: fullBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.number,
      body: fullBody,
    });
  }
}
