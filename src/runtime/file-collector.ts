import type { FilesMode } from "../config/types";
import {
  getFilesForCommitRange,
  getStagedFiles,
  getWorkspaceFiles,
  verifyGitRef,
} from "../utils/git";

export type FileCollectionMode = Exclude<FilesMode, "none" | undefined>;

export interface CollectFilesOptions {
  readonly root: string;
  readonly mode: FileCollectionMode;
  readonly baseRef?: string;
  readonly headRef?: string;
}

const pickFirst = (
  ...candidates: Array<string | undefined>
): string | undefined => {
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
};

const resolveCommitRange = async (
  root: string,
  baseRef?: string,
  headRef?: string,
): Promise<{ base: string; head: string } | undefined> => {
  const baseCandidate = pickFirst(
    baseRef,
    process.env.QUALITY_HOOK_BASE_REF,
    process.env.QUALITY_CI_BASE_REF,
    process.env.GITHUB_BASE_REF,
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH,
    process.env.CI_DEFAULT_BRANCH,
    "HEAD^",
  );

  const headCandidate = pickFirst(
    headRef,
    process.env.QUALITY_HOOK_HEAD_REF,
    process.env.QUALITY_CI_HEAD_REF,
    process.env.GITHUB_SHA,
    process.env.GITHUB_HEAD_REF,
    process.env.CI_COMMIT_SHA,
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA,
    "HEAD",
  );

  if (!baseCandidate || !headCandidate) {
    return undefined;
  }

  const [baseIsValid, headIsValid] = await Promise.all([
    verifyGitRef(root, baseCandidate),
    verifyGitRef(root, headCandidate),
  ]);

  if (!baseIsValid || !headIsValid) {
    return undefined;
  }

  return { base: baseCandidate, head: headCandidate };
};

export const collectFilesForMode = async (
  options: CollectFilesOptions,
): Promise<string[]> => {
  switch (options.mode) {
    case "staged":
      return getStagedFiles(options.root);
    case "workspace":
      return getWorkspaceFiles(options.root);
    case "commits": {
      const range = await resolveCommitRange(
        options.root,
        options.baseRef,
        options.headRef,
      );
      if (!range) {
        return [];
      }
      return getFilesForCommitRange(options.root, range.base, range.head);
    }
    default:
      return [];
  }
};
