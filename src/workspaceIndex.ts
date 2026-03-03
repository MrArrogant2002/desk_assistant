import * as vscode from 'vscode';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  rel:     string;       // workspace-relative path (forward slashes)
  lang:    string;       // language id
  symbols: string[];     // extracted function/class names
  size:    number;       // bytes
}

// ─── Language helpers ─────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
  cs: 'csharp', rb: 'ruby', kt: 'kotlin', swift: 'swift', php: 'php',
  json: 'json', md: 'markdown', css: 'css', html: 'html', sh: 'shellscript',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
};

function extLang(rel: string): string {
  const ext = rel.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'plaintext';
}

/** Regex-based symbol extraction — no AST dependency. */
function extractSymbols(content: string, lang: string): string[] {
  const symbols = new Set<string>();

  function addMatches(pattern: RegExp, captureIdx = 1): void {
    const re = new RegExp(pattern.source, pattern.flags.includes('m') ? pattern.flags : pattern.flags + 'm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[captureIdx];
      if (name && name.length > 1) { symbols.add(name.trim()); }
    }
  }

  switch (lang) {
    case 'typescript':
    case 'typescriptreact':
    case 'javascript':
    case 'javascriptreact':
      addMatches(/(?:async\s+)?function\s+(\w+)/gm);
      addMatches(/\bclass\s+(\w+)/gm);
      addMatches(/\b(?:interface|type)\s+(\w+)/gm);
      addMatches(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm);
      break;
    case 'python':
      addMatches(/^(?:async\s+)?def\s+(\w+)/gm);
      addMatches(/^class\s+(\w+)/gm);
      break;
    case 'go':
      addMatches(/^func\s+(?:\([^)]+\)\s+)?(\w+)/gm);
      addMatches(/^type\s+(\w+)/gm);
      break;
    case 'rust':
      addMatches(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm);
      addMatches(/^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/gm);
      break;
    case 'java':
    case 'kotlin':
    case 'csharp':
      addMatches(/\b(?:class|interface|enum)\s+(\w+)/gm);
      addMatches(/\b(?:fun|void|public|private|protected)\s+(\w+)\s*\(/gm);
      break;
  }

  const SKIP = new Set(['if', 'for', 'while', 'do', 'try', 'get', 'set', 'new', 'return', 'this', 'super']);
  return [...symbols].filter(s => !SKIP.has(s));
}

// ─── Default ignore patterns augmented from .deskignore ──────────────────────

const ALWAYS_IGNORE = [
  'node_modules', '.git', 'out', 'dist', 'build', '.next', '__pycache__',
  'target', '.venv', 'venv', '.DS_Store', '*.vsix', '*.map',
];

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

// ─── WorkspaceIndex ───────────────────────────────────────────────────────────

export class WorkspaceIndex {
  private _files   = new Map<string, FileEntry>();
  private _ignore: RegExp[] = [];
  private _watcher: vscode.FileSystemWatcher | null = null;
  private _root    = '';
  private _ready   = false;
  private _ctx!: vscode.ExtensionContext;

  async init(ctx: vscode.ExtensionContext): Promise<void> {
    this._ctx  = ctx;
    const wsf  = vscode.workspace.workspaceFolders?.[0];
    if (!wsf) { return; }
    this._root = wsf.uri.fsPath.replace(/\\/g, '/');

    await this._readDeskignore(wsf.uri);
    await this._scan();
    this._startWatchers();
    this._ready = true;
  }

  get ready(): boolean { return this._ready; }
  get root():  string  { return this._root; }

  /** @mention query — returns relative paths matching `prefix` */
  query(prefix: string, maxResults = 30): string[] {
    const p = prefix.toLowerCase();
    const matches: string[] = [];
    for (const [rel] of this._files) {
      if (!p || rel.toLowerCase().includes(p)) { matches.push(rel); }
      if (matches.length >= maxResults) { break; }
    }
    return matches;
  }

  getEntry(rel: string): FileEntry | undefined {
    return this._files.get(rel);
  }

  /** All entries for context-building */
  allEntries(): FileEntry[] {
    return [...this._files.values()];
  }

  /** Symbol search across all files — returns [{rel, symbol}] */
  searchSymbol(name: string): { rel: string; symbol: string }[] {
    const n = name.toLowerCase();
    const results: { rel: string; symbol: string }[] = [];
    for (const entry of this._files.values()) {
      for (const sym of entry.symbols) {
        if (sym.toLowerCase().includes(n)) {
          results.push({ rel: entry.rel, symbol: sym });
        }
      }
    }
    return results.slice(0, 20);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _readDeskignore(wsUri: vscode.Uri): Promise<void> {
    const patterns = [...ALWAYS_IGNORE];
    try {
      const uri = vscode.Uri.joinPath(wsUri, '.deskignore');
      const raw  = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      for (const line of raw.split('\n')) {
        const p = line.trim();
        if (p && !p.startsWith('#')) { patterns.push(p); }
      }
    } catch { /* no .deskignore — fine */ }
    this._ignore = patterns.map(globToRegex);
  }

  private _isIgnored(rel: string): boolean {
    const segs = rel.split('/');
    return this._ignore.some(rx => segs.some(seg => rx.test(seg)) || rx.test(rel));
  }

  private async _scan(): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/*', undefined, 5000);
    const tasks = uris.map(u => this._indexUri(u));
    await Promise.allSettled(tasks);
  }

  private async _indexUri(uri: vscode.Uri): Promise<void> {
    const rel = this._toRel(uri.fsPath);
    if (!rel || this._isIgnored(rel)) { return; }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 512_000) {
        // Large file: add to index without symbols
        const lang = extLang(rel);
        this._files.set(rel, { rel, lang, symbols: [], size: stat.size });
        return;
      }
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const lang    = extLang(rel);
      const symbols = extractSymbols(content, lang);
      this._files.set(rel, { rel, lang, symbols, size: stat.size });
    } catch { /* file deleted between scan and read */ }
  }

  private _startWatchers(): void {
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this._watcher.onDidCreate(uri => { this._indexUri(uri); });
    this._watcher.onDidChange(uri => { this._indexUri(uri); });
    this._watcher.onDidDelete(uri => {
      const rel = this._toRel(uri.fsPath);
      if (rel) { this._files.delete(rel); }
    });
    this._ctx.subscriptions.push(this._watcher);
  }

  private _toRel(fsPath: string): string {
    const fwd = fsPath.replace(/\\/g, '/');
    if (!this._root) { return fwd; }
    return fwd.startsWith(this._root + '/') ? fwd.slice(this._root.length + 1) : fwd;
  }
}

export const workspaceIndex = new WorkspaceIndex();
