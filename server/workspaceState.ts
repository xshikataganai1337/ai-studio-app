import path from 'path';
import fsPromises from 'fs/promises';

const SKIPPED_WORKSPACE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo'
]);

export const shouldSkipWorkspaceDir = (name: string) =>
  name.startsWith('.') || SKIPPED_WORKSPACE_DIRS.has(name);

export const snapshotWorkspaceState = async (
  root: string,
  maxFiles = 800
): Promise<Map<string, string>> => {
  const state = new Map<string, string>();
  let seen = 0;

  const walk = async (dir: string): Promise<void> => {
    if (seen >= maxFiles) return;

    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (seen >= maxFiles) break;
      if (entry.isDirectory() && shouldSkipWorkspaceDir(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!entry.isFile()) continue;

      try {
        const stat = await fsPromises.stat(full);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        state.set(rel, `${stat.size}:${Math.floor(stat.mtimeMs)}`);
        seen++;
      } catch {
        // Ignore files that disappear while the agent is mutating the workspace.
      }
    }
  };

  await walk(root);
  return state;
};

export const diffWorkspaceStates = (
  before: Map<string, string>,
  after: Map<string, string>
) => {
  const changed = new Set<string>();

  for (const [file, fingerprint] of after.entries()) {
    if (before.get(file) !== fingerprint) changed.add(file);
  }

  for (const file of before.keys()) {
    if (!after.has(file)) changed.add(file);
  }

  return [...changed];
};
