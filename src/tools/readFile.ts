import * as vscode from 'vscode';
import { validatePath } from './pathUtils';

const MAX_READ_BYTES = 100_000; // ~100 KB — keeps context window sane

export async function readFileTool(args: { path: string }): Promise<string> {
  if (!args.path) { return 'Error: path argument is required.'; }
  // Block path traversal attempts
  let safePath: string;
  try { safePath = validatePath(args.path); }
  catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)); }
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(safePath));
  } catch (e: unknown) {
    return 'Error reading file: ' + (e instanceof Error ? e.message : String(e));
  }
  if (bytes.byteLength > MAX_READ_BYTES) {
    const truncated = Buffer.from(bytes.slice(0, MAX_READ_BYTES)).toString('utf8');
    return truncated + `\n\n[...truncated — file is ${bytes.byteLength} bytes, showing first ${MAX_READ_BYTES}]`;
  }
  return Buffer.from(bytes).toString('utf8');
}
