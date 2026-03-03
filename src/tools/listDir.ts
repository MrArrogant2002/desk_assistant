import * as vscode from 'vscode';
import * as path from 'path';

export async function listDirTool(args: { path?: string }): Promise<string> {
  const p = args.path && args.path !== '.' ? args.path : '';
  const base = p && path.isAbsolute(p)
    ? vscode.Uri.file(p)
    : vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd()), p ?? ''
      );
  const entries = await vscode.workspace.fs.readDirectory(base);
  return entries.map(([n, t]) => n + (t === vscode.FileType.Directory ? '/' : '')).join('\n');
}
