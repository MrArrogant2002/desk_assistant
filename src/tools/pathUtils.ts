import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Validate and resolve a user-supplied path so it is safely within the workspace root.
 * Returns the resolved absolute path string on success.
 * Throws an Error with a clear message if the path attempts directory traversal.
 *
 * Allows:
 *   - Already-absolute paths that are children of wsRoot
 *   - Relative paths that resolve to children of wsRoot
 *
 * Blocks any path whose resolved form escapes wsRoot (e.g. "../../../etc/passwd").
 */
export function validatePath(userPath: string): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) { throw new Error('No workspace open — cannot resolve path safely.'); }

  // Resolve to absolute
  const abs = path.isAbsolute(userPath)
    ? path.normalize(userPath)
    : path.normalize(path.join(wsRoot, userPath));

  // Normalise both to use the same separator & casing (important on Windows)
  const normalRoot = path.normalize(wsRoot);

  // The resolved path must start with the workspace root (with a trailing sep
  // to prevent /workspace-extended/ from passing as a child of /workspace/).
  const rootWithSep = normalRoot.endsWith(path.sep) ? normalRoot : normalRoot + path.sep;
  if (abs !== normalRoot && !abs.startsWith(rootWithSep)) {
    throw new Error(
      `Path traversal blocked: "${userPath}" resolves outside of the workspace root.\n` +
      `Workspace: ${normalRoot}\nResolved:  ${abs}`
    );
  }

  return abs;
}

/**
 * Same as validatePath but returns null instead of throwing,
 * so callers that want a soft-reject can check for null.
 */
export function tryValidatePath(userPath: string): string | null {
  try { return validatePath(userPath); } catch { return null; }
}
