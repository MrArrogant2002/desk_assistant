import * as vscode from 'vscode';
import * as path from 'path';
import { ConfirmFn } from '../confirmationProvider';

function toUri(p: string): vscode.Uri {
  if (path.isAbsolute(p)) { return vscode.Uri.file(p); }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) { throw new Error('No workspace open'); }
  return vscode.Uri.joinPath(ws, p);
}

function stripFences(s: string): string {
  const m = s.trim().match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s.trim();
}

export async function writeFileTool(
  args: { path: string; content: string },
  confirm: ConfirmFn
): Promise<string> {
  const uri = toUri(args.path);
  const before = await vscode.workspace.fs.readFile(uri).then(
    b => Buffer.from(b).toString('utf8'), () => ''
  );
  const after = stripFences(args.content);
  if (!await confirm('Write file', args.path, before, after)) { return 'Skipped by user.'; }
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { ignoreIfExists: true });
  const fullRange = new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0);
  edit.replace(uri, fullRange, after);
  return await vscode.workspace.applyEdit(edit) ? 'File written.' : 'Edit failed.';
}
