import { Octokit } from 'octokit';

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const httpsMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new Error('Invalid GitHub URL');
}

export async function getRepoHead(owner: string, repo: string, branch: string): Promise<string> {
  const { data } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  return data.object.sha;
}

type GitHubErrorShape = {
  status?: number;
  message?: string;
  response?: {
    headers?: Record<string, string | number | undefined>;
  };
};

function parseGitHubError(error: unknown): GitHubErrorShape {
  if (!error || typeof error !== 'object') {
    return {};
  }

  return error as GitHubErrorShape;
}

export function isGitHubQuotaError(error: unknown): boolean {
  const parsed = parseGitHubError(error);
  const message = parsed.message ?? '';
  const remaining = parsed.response?.headers?.['x-ratelimit-remaining'];

  const exhaustedByHeader =
    parsed.status === 403 && (remaining === '0' || remaining === 0);

  return message.includes('Request quota exhausted') || exhaustedByHeader;
}

export function getGitHubQuotaErrorMessage(error: unknown): string {
  const parsed = parseGitHubError(error);
  const resetValue = parsed.response?.headers?.['x-ratelimit-reset'];

  if (typeof resetValue === 'string' || typeof resetValue === 'number') {
    const resetEpoch = Number(resetValue) * 1000;
    if (!Number.isNaN(resetEpoch) && resetEpoch > 0) {
      return `GitHub API quota exhausted. Try again after ${new Date(resetEpoch).toISOString()}.`;
    }
  }

  return 'GitHub API quota exhausted. Add a valid GITHUB_TOKEN and retry shortly.';
}
