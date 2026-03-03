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

function stripFences(s: string): string {
  const m = s.trim().match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s.trim();
}

export async function writeFileTool(
  args: { path: string; content: string },
  confirm: ConfirmFn
): Promise<string> {
  // Block path traversal attempts
  let safePath: string;
  try { safePath = validatePath(args.path); }
  catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)); }

  const uri = vscode.Uri.file(safePath);
  const before = await vscode.workspace.fs.readFile(uri).then(
    b => Buffer.from(b).toString('utf8'), () => ''
  );
  const after = stripFences(args.content);
  if (!await confirm('Write file', args.path, before, after)) { return 'Skipped by user.'; }
  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(after, 'utf8'));
    auditLog('WRITE', `write_file: ${args.path} (${after.length} chars)`);
    return 'File written successfully.';
  } catch (e: unknown) {
    return 'Write failed: ' + (e instanceof Error ? e.message : String(e));
  }
}
