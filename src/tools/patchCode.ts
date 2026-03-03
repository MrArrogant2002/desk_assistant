import * as vscode from 'vscode';
import * as path from 'path';
import { ConfirmFn } from '../confirmationProvider';
import { validatePath } from './pathUtils';
import { auditLog } from '../auditLog';

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
  // Block path traversal attempts
  let safePath: string;
  try { safePath = validatePath(args.path); }
  catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)); }
  const uri = vscode.Uri.file(safePath);
  const bytes = await vscode.workspace.fs.readFile(uri);
  const before = Buffer.from(bytes).toString('utf8');
  if (!before.includes(args.search)) {
    return 'ERROR: search text not found in file. Call read_file first and use exact text.';
  }
  // Use split/join instead of String.replace to avoid interpreting $& / $' / $` / $n
  // special replacement patterns that would corrupt the patched content.
  const after = before.split(args.search).join(args.replace);
  if (!await confirm('Patch file', args.path, before, after)) { return 'Skipped by user.'; }
  const edit = new vscode.WorkspaceEdit();
  // MAX_SAFE_INTEGER for both line + character ensures we cover the last char of the last line.
  edit.replace(uri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), after);
  const ok = await vscode.workspace.applyEdit(edit);
  if (ok) { auditLog('WRITE', `patch_code: ${args.path}`); }
  return ok ? 'Patched.' : 'Edit failed.';
}
