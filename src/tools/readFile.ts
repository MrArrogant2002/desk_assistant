import * as vscode from 'vscode';
import * as path from 'path';

function toUri(p: string): vscode.Uri {
  if (path.isAbsolute(p)) { return vscode.Uri.file(p); }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) { throw new Error('No workspace open'); }
  return vscode.Uri.joinPath(ws, p);
}

export async function readFileTool(args: { path: string }): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(toUri(args.path));
  return Buffer.from(bytes).toString('utf8');
}
