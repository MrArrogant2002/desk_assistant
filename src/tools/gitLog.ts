import * as cp from 'child_process';
import * as vscode from 'vscode';

/**
 * Run `git log --oneline --graph --decorate -n <limit>` in the workspace root.
 * Returns a compact, human-readable git log (default last 20 commits).
 * Limit is capped at 100 to avoid flooding context.
 * No confirmation required — read-only operation.
 */
export async function gitLogTool(args: { limit?: number; cwd?: string }): Promise<string> {
  const root = args.cwd
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? process.cwd();

  const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
  const cmd = `git log --oneline --graph --decorate -n ${limit}`;

  return new Promise(resolve => {
    cp.exec(cmd, { cwd: root, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve('git error: ' + (stderr?.trim() || err.message));
        return;
      }
      const out = stdout.trim();
      resolve(out || '(no commits yet — repository is empty)');
    });
  });
}
