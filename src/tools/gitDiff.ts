import * as cp from 'child_process';
import * as vscode from 'vscode';

/**
 * Run `git diff` (unstaged) or `git diff --staged` (staged changes only).
 * Pass args.staged=true  to see what is staged for the next commit.
 * Pass args.path to limit the diff to a specific file or directory.
 * Output is capped at 1 MB to prevent flooding context.
 * No confirmation required — read-only operation.
 */
export async function gitDiffTool(args: {
  staged?: boolean;
  path?: string;
  cwd?: string;
}): Promise<string> {
  const root = args.cwd
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? process.cwd();

  const stagePart = args.staged ? '--staged ' : '';
  // Wrap user-supplied path in quotes for safety; strip internal quotes.
  const pathPart  = args.path
    ? `-- "${args.path.replace(/"/g, '')}"`
    : '';
  const cmd = `git diff ${stagePart}${pathPart}`.trimEnd();

  return new Promise(resolve => {
    cp.exec(cmd, { cwd: root, timeout: 10_000, maxBuffer: 1_048_576 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve('git error: ' + (stderr?.trim() || err.message));
        return;
      }
      const out = stdout.trim();
      if (!out) {
        const note = args.staged
          ? '(no staged changes — stage files with `git add` first)'
          : '(no unstaged changes — working tree matches HEAD)';
        resolve(note);
        return;
      }
      // Truncate very large diffs with a notice
      if (out.length > 900_000) {
        resolve(out.slice(0, 900_000) + '\n\n[…diff truncated at ~900 KB]');
        return;
      }
      resolve(out);
    });
  });
}
