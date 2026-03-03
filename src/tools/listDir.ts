import * as vscode from 'vscode';
import { tryValidatePath } from './pathUtils';

export async function listDirTool(args: { path?: string }): Promise<string> {
  const p = args.path && args.path !== '.' ? args.path : '';
  // Validate path if provided — block traversal outside workspace
  if (p) {
    const safe = tryValidatePath(p);
    if (!safe) {
      return `Error: Path "${p}" is outside the workspace root or blocked for safety.`;
    }
    const base = vscode.Uri.file(safe);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(base);
    } catch (e: unknown) {
      return 'Error listing directory: ' + (e instanceof Error ? e.message : String(e));
    }
    if (!entries.length) { return '(empty directory)'; }
    return entries
      .sort(([, ta], [, tb]) => (tb === vscode.FileType.Directory ? 1 : 0) - (ta === vscode.FileType.Directory ? 1 : 0))
      .map(([n, t]) => n + (t === vscode.FileType.Directory ? '/' : ''))
      .join('\n');
  }
  const base = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd()), ''
      );
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(base);
  } catch (e: unknown) {
    return 'Error listing directory: ' + (e instanceof Error ? e.message : String(e));
  }
  if (!entries.length) { return '(empty directory)'; }
  return entries
    .sort(([, ta], [, tb]) => (tb === vscode.FileType.Directory ? 1 : 0) - (ta === vscode.FileType.Directory ? 1 : 0))
    .map(([n, t]) => n + (t === vscode.FileType.Directory ? '/' : ''))
    .join('\n');
}
