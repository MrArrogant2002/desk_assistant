import * as cp from 'child_process';
import * as vscode from 'vscode';

/**
 * Run `git status --porcelain -b` in the workspace root (or explicit cwd).
 * Returns compact status output (branch + changed files) suitable for the AI to read.
 * No confirmation required — read-only operation.
 */
export async function gitStatusTool(args: { cwd?: string }): Promise<string> {
  const root = args.cwd
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? process.cwd();

  return new Promise(resolve => {
    cp.exec('git status --porcelain -b', { cwd: root, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve('git error: ' + (stderr?.trim() || err.message));
        return;
      }
      const out = stdout.trim();
      resolve(out || '(working tree clean — no uncommitted changes)');
    });
  });
}
