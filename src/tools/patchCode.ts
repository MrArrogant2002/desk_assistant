import * as vscode from 'vscode';
import * as path from 'path';
import { ConfirmFn } from '../confirmationProvider';

function toUri(p: string): vscode.Uri {
  if (path.isAbsolute(p)) { return vscode.Uri.file(p); }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!ws) { throw new Error('No workspace open'); }
  return vscode.Uri.joinPath(ws, p);
}

export async function patchCodeTool(
  args: { path: string; search: string; replace: string },
  confirm: ConfirmFn
): Promise<string> {
  const uri = toUri(args.path);
  const bytes = await vscode.workspace.fs.readFile(uri);
  const before = Buffer.from(bytes).toString('utf8');
  if (!before.includes(args.search)) {
    return 'ERROR: search text not found in file. Call read_file first and use exact text.';
  }
  const after = before.replace(args.search, args.replace);
  if (!await confirm('Patch file', args.path, before, after)) { return 'Skipped by user.'; }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), after);
  return await vscode.workspace.applyEdit(edit) ? 'Patched.' : 'Edit failed.';
}
