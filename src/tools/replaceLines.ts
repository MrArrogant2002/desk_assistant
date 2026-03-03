import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { validatePath } from './pathUtils';
import { ConfirmFn } from '../confirmationProvider';
import { auditLog } from '../auditLog';

/**
 * Replace a range of lines in a file (1-based, inclusive).
 * Much more reliable than patch_code because it doesn't require
 * exact verbatim text matching — only line numbers.
 *
 * args.start  — first line to replace (1-based)
 * args.end    — last  line to replace (1-based, inclusive). If omitted, same as start.
 * args.content — new text that replaces those lines (can be multiple lines with \n).
 *                Pass "" to delete the lines.
 */
export async function replaceLinesTool(
  args: { path: string; start: number; end?: number; content: string },
  confirm: ConfirmFn
): Promise<string> {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const safePath = validatePath(args.path);

  const absPath = path.isAbsolute(safePath)
    ? safePath
    : path.join(wsRoot ?? process.cwd(), safePath);

  let src: string;
  try {
    src = await fs.readFile(absPath, 'utf8');
  } catch {
    return `Error: cannot read "${args.path}" — file not found.`;
  }

  const lines = src.split('\n');
  const total = lines.length;

  const start = Math.max(1, args.start);
  const end   = Math.max(start, args.end ?? start);

  if (start > total) {
    return `Error: start line ${start} is beyond end of file (${total} lines).`;
  }

  // Build before / after for diff confirmation
  const beforeSlice = lines.slice(start - 1, end).join('\n');
  const newLines    = args.content === '' ? [] : args.content.split('\n');
  const after       = [
    ...lines.slice(0, start - 1),
    ...newLines,
    ...lines.slice(end),
  ].join('\n');

  auditLog('REPLACE_LINES', `${args.path} lines ${start}-${end}`);

  const ok = await confirm(
    `Replace lines ${start}–${end} in ${args.path}`,
    absPath,
    beforeSlice,
    args.content
  );
  if (!ok) { return 'Skipped by user.'; }

  try {
    await fs.writeFile(absPath, after, 'utf8');
  } catch (e: unknown) {
    return 'Write error: ' + (e instanceof Error ? e.message : String(e));
  }

  return `Replaced lines ${start}–${end} in ${args.path} (${end - start + 1} line(s) → ${newLines.length} line(s)).`;
}
