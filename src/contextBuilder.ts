import * as vscode from 'vscode';
import { workspaceIndex, FileEntry } from './workspaceIndex';
import { IntentType } from './modelRouter';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuiltContext {
  /** Active editor file content (may be truncated) */
  activeFileBlock:  string;
  /** @mentioned files, each wrapped in <file path="..."> */
  mentionedBlocks:  string;
  /** Related files inferred from imports (up to 2) */
  relatedBlocks:    string;
  /** Combined string ready to append to the user message */
  combined:         string;
}

// ─── How many tokens (chars) to cap per file by intent ───────────────────────

const INTENT_FILE_CAP: Record<IntentType, number> = {
  CODE_WRITE:   12_000,
  CODE_DEBUG:   10_000,
  CODE_EXPLAIN: 10_000,
  CODE_REVIEW:  12_000,
  CONVERSATION:  2_000,
  REASONING:     4_000,
  SEARCH:        2_000,
  FILE_OP:      12_000,
  GIT:           6_000,
};

// ─── Import graph: extract first-party imports from a source file ─────────────

function extractImports(content: string, lang: string): string[] {
  const result: string[] = [];

  if (lang === 'typescript' || lang === 'typescriptreact' ||
      lang === 'javascript' || lang === 'javascriptreact') {
    // import ... from './foo'  /  require('./foo')
    const re = /(?:import|require)[^'"]*['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) { result.push(m[1]); }
  } else if (lang === 'python') {
    const re = /from\s+\.(\S+)\s+import|import\s+\.(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) { result.push(m[1] ?? m[2]); }
  } else if (lang === 'go') {
    const re = /"\.\/([\w/]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) { result.push(m[1]); }
  }

  return result;
}

/** Resolve a relative import string to a workspace-relative file path */
function resolveImport(importer: string, importSpec: string): string[] {
  // importer: e.g. "src/foo/bar.ts"
  // importSpec: e.g. "./utils" or "../helpers"
  const dir = importer.split('/').slice(0, -1).join('/');
  const candidate = dir ? dir + '/' + importSpec.replace(/^\.\//, '') : importSpec.replace(/^\.\//, '');
  // Try with common extensions
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
  return exts.map(e => candidate + e);
}

// ─── ContextBuilder ───────────────────────────────────────────────────────────

export class ContextBuilder {

  /**
   * Build smart context for a user message.
   *
   * @param userMessage  Raw text (may contain @mentions)
   * @param intent       Router decision intent (affects file size cap)
   */
  async build(userMessage: string, intent?: IntentType): Promise<BuiltContext> {
    const cap = intent ? (INTENT_FILE_CAP[intent] ?? 10_000) : 10_000;

    // 1 — Active editor file
    const activeFileBlock = await this._activeFileBlock(cap);

    // 2 — @mentioned files
    const mentions      = this._parseMentions(userMessage);
    const mentionedBlocks = await this._mentionBlocks(mentions, cap);

    // 3 — Related files from import graph (only when intent is code-focused)
    const codeIntents: (IntentType | undefined)[] = [
      'CODE_WRITE', 'CODE_DEBUG', 'CODE_EXPLAIN', 'CODE_REVIEW', 'FILE_OP',
    ];
    let relatedBlocks = '';
    if (codeIntents.includes(intent)) {
      const activeRel = this._activeRel();
      if (activeRel) {
        relatedBlocks = await this._relatedBlocks(activeRel, cap / 2);
      }
    }

    const combined = [activeFileBlock, mentionedBlocks, relatedBlocks]
      .filter(Boolean)
      .join('\n');

    return { activeFileBlock, mentionedBlocks, relatedBlocks, combined };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _activeFileBlock(cap: number): Promise<string> {
    if (!vscode.workspace.getConfiguration('deskAssistant').get<boolean>('injectActiveFile', true)) {
      return '';
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return ''; }
    const doc  = editor.document;
    const text = doc.getText();
    if (!text.trim()) { return ''; }

    const rel    = this._toRel(doc.uri.fsPath);
    const sliced = text.length > cap ? text.slice(0, cap) + '\n…[truncated]' : text;
    return `\n<active_file path="${rel}">\n${sliced}\n</active_file>\n`;
  }

  private _activeRel(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }
    return this._toRel(editor.document.uri.fsPath);
  }

  private _parseMentions(text: string): string[] {
    return [...text.matchAll(/@([\w./\\-]+)/g)].map(m => m[1]);
  }

  private async _mentionBlocks(mentions: string[], cap: number): Promise<string> {
    if (!mentions.length) { return ''; }
    const parts: string[] = [];
    for (const m of mentions) {
      try {
        const ws  = vscode.workspace.workspaceFolders?.[0]?.uri;
        const uri = ws ? vscode.Uri.joinPath(ws, m) : vscode.Uri.file(m);
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const sliced = raw.length > cap ? raw.slice(0, cap) + '\n…[truncated]' : raw;
        parts.push(`\n<file path="${m}">\n${sliced}\n</file>\n`);
      } catch { /* mention not readable */ }
    }
    return parts.join('');
  }

  private async _relatedBlocks(activeRel: string, cap: number): Promise<string> {
    const entry = workspaceIndex.getEntry(activeRel);
    if (!entry) { return ''; }

    // Read active file to extract imports
    const ws  = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!ws) { return ''; }
    let content = '';
    try {
      content = Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ws, activeRel))
      ).toString('utf8');
    } catch { return ''; }

    const imports = extractImports(content, entry.lang);
    const found: string[] = [];
    for (const imp of imports.slice(0, 5)) {
      const candidates = resolveImport(activeRel, imp);
      for (const c of candidates) {
        if (workspaceIndex.getEntry(c)) { found.push(c); break; }
      }
      if (found.length >= 2) { break; }
    }

    const parts: string[] = [];
    for (const rel of found) {
      try {
        const uri  = vscode.Uri.joinPath(ws, rel);
        const raw  = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        const sliced = raw.length > cap ? raw.slice(0, cap) + '\n…[truncated]' : raw;
        parts.push(`\n<related_file path="${rel}">\n${sliced}\n</related_file>\n`);
      } catch { /* skip */ }
    }
    return parts.join('');
  }

  private _toRel(fsPath: string): string {
    const fwd  = fsPath.replace(/\\/g, '/');
    const root = (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '').replace(/\\/g, '/');
    return root && fwd.startsWith(root + '/') ? fwd.slice(root.length + 1) : fwd;
  }
}

export const contextBuilder = new ContextBuilder();
