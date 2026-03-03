import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ChatMessage, streamChat, listModels } from './ollamaClient';
import { buildSystemPrompt } from './systemPrompt';
import { ConfirmFn, SimpleConfirmFn } from './confirmationProvider';
import { readFileTool }   from './tools/readFile';
import { writeFileTool }  from './tools/writeFile';
import { patchCodeTool }  from './tools/patchCode';
import { listDirTool }    from './tools/listDir';
import { runTerminalTool } from './tools/runTerminal';

// ─── Tool call parser ────────────────────────────────────────────────────────

interface ToolCall { tool: string; args: Record<string, unknown>; }

const KNOWN = ['read_file','write_file','patch_code','list_dir','run_terminal'];

/** Escape literal control chars (newlines, tabs, CR) inside JSON string values. */
function sanitizeJsonStrings(raw: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\' && inStr) { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr) {
      if      (ch === '\n') { out += '\\n'; }
      else if (ch === '\r') { out += '\\r'; }
      else if (ch === '\t') { out += '\\t'; }
      else { out += ch; }
    } else {
      out += ch;
    }
  }
  return out;
}

function fixJson(raw: string): Record<string, unknown> | null {
  const candidates = [
    raw,
    sanitizeJsonStrings(raw),
    sanitizeJsonStrings(raw).replace(/\\(?!["\\/bfnrtu])/g, '\\\\'),
    raw.replace(/\\(?!["\\/bfnrtu])/g, '\\\\'),
  ];
  for (const s of candidates) {
    try { return JSON.parse(s); } catch { /* try next */ }
  }
  return null;
}

function normalise(name: string): string {
  const n = name.trim().toLowerCase().replace(/tool$/i, '').replace(/[^a-z_]/g, '');
  return KNOWN.find(k => n === k || n.startsWith(k)) ?? n;
}

function parse(text: string): ToolCall | null {
  // 1 — XML <tool_call>
  const xml = text.match(/<tool_call[^>]*>[\s]*<tool>([\s\S]*?)<\/tool>[\s]*<args>([\s\S]*?)<\/args>[\s]*<\/tool_call>/i);
  if (xml) {
    const args = fixJson(xml[2].trim());
    if (args) { return { tool: normalise(xml[1]), args }; }
  }
  // 2 — JSON object {"tool":"...","args":{...}}
  const jm = text.match(/\{[\s]*"tool"[\s]*:[\s\S]*?\}/);
  if (jm) {
    const obj = fixJson(jm[0]) as { tool?: string; args?: Record<string, unknown> } | null;
    if (obj?.tool && obj?.args) { return { tool: normalise(obj.tool), args: obj.args }; }
  }
  // 3 — loose: tool_name{...}  or  tool_nameTOOL{...}
  for (const k of KNOWN) {
    const m = text.match(new RegExp(k + '(?:tool)?\\s*?({[\\s\\S]*?})', 'i'));
    if (m) { const args = fixJson(m[1]); if (args) { return { tool: k, args }; } }
  }
  return null;
}

// ─── Tool dispatcher ─────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label + ' timed out after ' + ms + 'ms')), ms)),
  ]);
}

async function dispatch(call: ToolCall, cf: ConfirmFn, scf: SimpleConfirmFn): Promise<string> {
  const run = (() => {
    switch (call.tool) {
      case 'read_file':    return readFileTool(call.args as { path: string });
      case 'write_file':   return writeFileTool(call.args as { path: string; content: string }, cf);
      case 'patch_code':   return patchCodeTool(call.args as { path: string; search: string; replace: string }, cf);
      case 'list_dir':     return listDirTool(call.args as { path?: string });
      case 'run_terminal': return runTerminalTool(call.args as { command: string; cwd?: string }, scf);
      default:             return Promise.resolve('Unknown tool: ' + call.tool);
    }
  })();
  return withTimeout(run, 15000, call.tool);
}

// ─── ChatPanel ───────────────────────────────────────────────────────────────

export class ChatPanel {
  private static instance: ChatPanel | undefined;
  private static model: string;

  private readonly panel: vscode.WebviewPanel;
  private readonly ctx: vscode.ExtensionContext;
  private history: ChatMessage[] = [];
  private abort: AbortController | null = null;
  private pending = new Map<string, (ok: boolean) => void>();
  private subs: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext) {
    this.panel = panel; this.ctx = ctx;
    ChatPanel.model = vscode.workspace.getConfiguration('deskAssistant')
      .get<string>('defaultModel', 'mistral:latest');

    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.subs);
    this.panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.visible) { this.init(); }
    }, null, this.subs);
    this.panel.webview.onDidReceiveMessage((m) => this.onMsg(m), null, this.subs);
    this.init();
  }

  static createOrShow(ctx: vscode.ExtensionContext): ChatPanel {
    if (ChatPanel.instance) { ChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside); return ChatPanel.instance; }
    const panel = vscode.window.createWebviewPanel('deskAssistant', 'Desk Assistant', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'webview')],
    });
    ChatPanel.instance = new ChatPanel(panel, ctx);
    return ChatPanel.instance;
  }

  static updateModel(m: string) {
    ChatPanel.model = m;
    ChatPanel.instance?.init();
  }

  private post(msg: unknown) { this.panel.webview.postMessage(msg); }

  private init() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    this.post({ type: 'workspace', path: root });
    listModels().then(list => this.post({ type: 'models', list, active: ChatPanel.model }));
  }

  private onMsg(m: { type: string; text?: string; model?: string; id?: string; accepted?: boolean }) {
    switch (m.type) {
      case 'send':
        this._depth = 0;
        this._lastCallKey = '';
        this.chat(m.text ?? '', m.model ?? ChatPanel.model)
          .catch((e: unknown) => {
            this.post({ type: 'error', msg: 'Fatal: ' + (e instanceof Error ? e.message : String(e)) });
          });
        break;
      case 'confirm':
        { const r = this.pending.get(m.id ?? ''); if (r) { this.pending.delete(m.id!); r(m.accepted ?? false); } break; }
      case 'stop':
        this.abort?.abort();
        this.abort = null;
        break;
      case 'model':
        if (m.model) { ChatPanel.model = m.model; this.history = []; }
        break;
      case 'clear':
        this.history = [];
        break;
    }
  }

  private _depth = 0;
  private _lastCallKey = '';

  private async chat(text: string, model: string): Promise<void> {
    if (this._depth > 8) {
      this.post({ type: 'error', msg: 'Too many consecutive tool calls — stopping to prevent a loop.' });
      this.post({ type: 'done' });
      this._depth = 0;
      return;
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    if (this.history.length === 0) {
      this.history.push({ role: 'system', content: buildSystemPrompt(root) });
    }
    if (text) { this.history.push({ role: 'user', content: text }); }

    this.abort = new AbortController();
    this.post({ type: 'streamStart' });

    let response = '';
    try {
      response = await streamChat(model, this.history, d => this.post({ type: 'token', d }), this.abort.signal);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.post({ type: 'streamEnd', cancelled: msg.toLowerCase().includes('abort') });
      if (!msg.toLowerCase().includes('abort')) { this.post({ type: 'error', msg }); }
      this.post({ type: 'done' });
      this._depth = 0;
      return;
    }
    this.post({ type: 'streamEnd', cancelled: false });

    // Extract <think> / <Thought> blocks and show them in the UI, then strip before parsing
    const thinkRe = /<(?:think|[Tt]hought)>([\s\S]*?)<\/(?:think|[Tt]hought)>/g;
    let thinkMatch: RegExpExecArray | null;
    while ((thinkMatch = thinkRe.exec(response)) !== null) {
      this.post({ type: 'thinking', text: thinkMatch[1].trim() });
    }
    const stripped = response.replace(/<(?:think|[Tt]hought)>[\s\S]*?<\/(?:think|[Tt]hought)>/g, '').trim();
    const call = parse(stripped || response);

    if (!call) {
      // Model only produced a <think> block and nothing else — nudge it to execute
      if (!stripped) {
        this.history.push({ role: 'assistant', content: response });
        this.history.push({
          role: 'user',
          content: "You've analysed the task. Now execute it — call the appropriate tool immediately."
        });
        this._depth++;
        await this.chat('', model);
        return;
      }
      // Normal plain-text reply — done
      this.history.push({ role: 'assistant', content: response });
      this.post({ type: 'done' });
      this._depth = 0;
      return;
    }

    // Detect repeated identical tool call → break the loop
    const callKey = call.tool + '::' + JSON.stringify(call.args);
    if (callKey === this._lastCallKey) {
      this.history.push({ role: 'assistant', content: response });
      this.post({ type: 'error', msg: 'Repeated identical tool call detected — stopping loop.' });
      this.post({ type: 'done' });
      this._depth = 0;
      this._lastCallKey = '';
      return;
    }
    this._lastCallKey = callKey;

    this.history.push({ role: 'assistant', content: response });
    this.post({ type: 'tool', name: call.tool, args: call.args });

    let result: string;
    try {
      result = await dispatch(call, this.confirm.bind(this), this.simpleConfirm.bind(this));
    } catch (e: unknown) {
      result = 'Tool error: ' + (e instanceof Error ? e.message : String(e));
    }
    this.post({ type: 'result', text: result });
    // Tell the model the result and explicitly signal it to stop if done
    this.history.push({
      role: 'user',
      content: '<tool_result>\n' + result + '\n</tool_result>\n\n' +
        'Tool call completed. Write a <think> block assessing whether the task is fully done. ' +
        'If yes, reply with a short confirmation. If more steps are genuinely needed, call the next tool.'
    });
    this._depth++;
    await this.chat('', model);
  }

  private confirm(title: string, filePath: string, before: string, after: string): Promise<boolean> {
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise(res => {
      this.pending.set(id, res);
      this.post({ type: 'confirmReq', id, title, filePath, before, after });
    });
  }

  private simpleConfirm(title: string, detail: string): Promise<boolean> {
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise(res => {
      this.pending.set(id, res);
      this.post({ type: 'simpleConfirmReq', id, title, detail });
    });
  }

  private html(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const uri = (f: string) => this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'webview', f)
    );
    return `<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\">
  <meta http-equiv=\"Content-Security-Policy\"
    content=\"default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}'\">
  <link rel=\"stylesheet\" href=\"${uri('styles.css')}\">
</head>
<body>
  <div id=\"header\">
    <span id=\"title\">Desk Assistant</span>
    <div id=\"controls\">
      <select id=\"model\"></select>
      <button id=\"clear\">Clear</button>
    </div>
  </div>
  <div id=\"ws-bar\">Workspace: <span id=\"ws-path\">loading…</span></div>
  <div id=\"msgs\"></div>
  <div id=\"foot\">
    <textarea id=\"inp\" placeholder=\"Ask anything… (Shift+Enter for newline)\" rows=\"3\"></textarea>
    <div id=\"btns\">
      <button id=\"send\">Send</button>
      <button id=\"stop\" style=\"display:none\">Stop</button>
    </div>
  </div>
  <script nonce=\"${nonce}\" src=\"${uri('main.js')}\"></script>
</body>
</html>`;
  }

  dispose() { ChatPanel.instance = undefined; this.panel.dispose(); this.subs.forEach(d => d.dispose()); }
}
