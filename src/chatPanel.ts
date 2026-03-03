import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ChatMessage, streamChat, listModels, warmupModel, generateOnce, unloadModel } from './ollamaClient';
import { buildSystemPrompt, SystemPromptOptions } from './systemPrompt';
import { ConfirmFn, SimpleConfirmFn } from './confirmationProvider';
import { modelRouter, RouterDecision } from './modelRouter';
import { getDiagnosticsContext, getDiagnosticsSummary } from './diagnosticsProvider';
import { workspaceIndex } from './workspaceIndex';
import { contextBuilder } from './contextBuilder';
import { MemoryManager, Session } from './memoryManager';
import { auditLog } from './auditLog';
import { parseToolCall, extractThinking, executeToolCall } from './toolEngine';
import { gitDiffTool } from './tools/gitDiff'; // used directly in handleGenerateCommit

// ─── ChatViewProvider ────────────────────────────────────────────────────────

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private model: string;
  private _activeModel: string;          // specialist chosen by router (may differ from this.model)
  private _currentDecision: RouterDecision | null = null;
  private _availableModels: string[] = [];   // cached model list for router
  private history: ChatMessage[] = [];
  private abort: AbortController | null = null;
  private pending = new Map<string, (ok: boolean) => void>();
  private mem: MemoryManager;
  private session: Session | null = null;   // currently active session
  // ── Item 29: Request queuing ──────────────────────────────────────────────
  private _queue: Array<{ text: string }> = [];
  private _busy  = false;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.model = vscode.workspace.getConfiguration('deskAssistant')
      .get<string>('defaultModel', 'llama3.2:latest');
    this._activeModel = this.model;
    this.mem = new MemoryManager(ctx.globalStorageUri);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'webview')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(m => this.onMsg(m));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) { this.sendInit(); }
    });
    // sendInit() is NOT called here — wait for 'ready' signal so JS listener is registered first.
  }

  async newChat() {
    this.history = [];
    this._depth = 0;
    this._lastCallKey = '';
    this._currentDecision = null;
    this._activeModel = this.model;
    this.session = await this.mem.createSession(this.model);
    this._view?.webview.postMessage({ type: 'clearChat' });
    this.sendSessions();
    this.sendInit();
  }

  setModel(m: string) {
    this.model = m;
    this._activeModel = m;
    this._currentDecision = null;
    this._view?.webview.postMessage({ type: 'modelChanged', model: m });
    warmupModel(m);  // pre-load into VRAM so first response is fast
  }

  private post(msg: unknown) { this._view?.webview.postMessage(msg); }

  private sendInit() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    this.post({ type: 'workspace', path: root });

    // Item 21: detect project type and save as __project__ memory fact
    if (root) {
      this.mem.detectProjectContext(root).catch(() => { /* silent */ });
    }

    // Auto-purge facts whose expiry timestamp has passed
    this.mem.pruneExpiredFacts().then(removed => {
      if (removed.length) {
        this.post({ type: 'info', msg: `🕐 Auto-expired ${removed.length} memory fact(s): **${removed.join(', ')}**` });
      }
    }).catch(() => { /* silent */ });

    listModels().then(async list => {
      this._availableModels = list;
      // ── Auto-clean: remove stale model preference ────────────────────────
      if (list.length && !list.includes(this.model)) {
        const prev = this.model;
        this.model = list[0];
        vscode.workspace.getConfiguration('deskAssistant')
          .update('defaultModel', this.model, vscode.ConfigurationTarget.Global);
        this.post({
          type: 'info',
          msg: `ℹ Model **${prev}** is no longer installed. Switched to **${this.model}**.`,
        });
      }
      this.post({ type: 'models', list, active: this.model });

      // Prune sessions whose model was removed
      const removed = await this.mem.pruneOrphanedModelSessions(list);
      if (removed.length) {
        this.post({
          type: 'info',
          msg: `🗑 Removed ${removed.length} session(s) for uninstalled models.`,
        });
        this.sendSessions();
      }

      // Warm up the active model
      warmupModel(this.model);
    });
  }

  private async sendSessions() {
    const sessions = await this.mem.listSessions();
    this.post({ type: 'sessions', list: sessions, activeId: this.session?.id ?? null });
  }

  private onMsg(m: {
    type: string; text?: string; model?: string; id?: string; accepted?: boolean;
    prefix?: string; sessionId?: string; msgIdx?: number; newText?: string; content?: string;
  }) {
    switch (m.type) {
      case 'send': {
        const txt = m.text ?? '';
        if (this._busy) {
          this._queue.push({ text: txt });
          this.post({ type: 'info', msg: `⏳ Queued (${this._queue.length} waiting). Current response will finish first.` });
        } else {
          this._depth = 0;
          this._lastCallKey = '';
          this._queue.push({ text: txt });
          this.runNextInQueue();
        }
        break;
      }
      case 'confirm': {
        const r = this.pending.get(m.id ?? '');
        if (r) { this.pending.delete(m.id!); r(m.accepted ?? false); }
        break;
      }
      case 'stop':
        this.abort?.abort();
        this.abort = null;
        break;
      case 'model':
        if (m.model) {
          this.model = m.model;
          this._activeModel = m.model;
          this._currentDecision = null;
          this.history = [];
          this.session = null;  // new model → new session on next send
          // Persist preference so it survives restarts
          vscode.workspace.getConfiguration('deskAssistant')
            .update('defaultModel', m.model, vscode.ConfigurationTarget.Global);
          warmupModel(m.model);
        }
        break;
      case 'ready':
        this.sendInit();
        this.sendSessions();
        break;
      case 'newChat':
        this.history = [];
        this._depth = 0;
        this._lastCallKey = '';
        // Create a fresh session immediately so the panel reflects it
        this.mem.createSession(this.model).then(s => {
          this.session = s;
          this.sendSessions();
        });
        break;
      case 'clear':
        this.history = [];
        this._depth = 0;
        this._lastCallKey = '';
        this.session = null;
        break;
      case 'loadSession':
        if (m.sessionId) { this.loadSession(m.sessionId); }
        break;
      case 'deleteSession':
        if (m.sessionId) {
          this.mem.deleteSession(m.sessionId).then(() => this.sendSessions());
          if (this.session?.id === m.sessionId) {
            this.history = [];
            this.session = null;
            this._view?.webview.postMessage({ type: 'clearChat' });
          }
        }
        break;
      case 'getFiles':
        this.handleGetFiles(m.prefix ?? '');
        break;
      case 'remember':
        if (m.text) {
          const parts = m.text.split('=');
          const key = parts[0]?.trim();
          const val = parts.slice(1).join('=').trim();
          if (key && val) {
            this.mem.saveFact(key, val).then(() =>
              this.post({ type: 'info', msg: `Remembered: **${key}** = ${val}` })
            );
          } else {
            this.post({ type: 'info', msg: 'Usage: /remember key = value' });
          }
        }
        break;
      case 'memoryList':
        this.mem.getFacts().then(facts => {
          const now = Date.now();
          const live = facts.filter(f => !f.expiresAt || f.expiresAt > now);
          const text = live.length
            ? live.map(f => {
                const cat = f.category ? ` _(${f.category})_` : '';
                const exp = f.expiresAt ? ` _(expires ${new Date(f.expiresAt).toLocaleDateString()})_` : '';
                return `**${f.key}**${cat}: ${f.value}${exp}`;
              }).join('\n')
            : '_No memories stored yet._';
          this.post({ type: 'info', msg: text });
        });
        break;

      // ── /forget <key> ────────────────────────────────────────────────────────
      case 'forget':
        if (m.text?.trim()) {
          const key = m.text.trim();
          this.mem.forgetFact(key).then(() =>
            this.post({ type: 'info', msg: `🧹 Forgot memory key: **${key}**` })
          );
        } else {
          this.post({ type: 'info', msg: 'Usage: /forget <key>' });
        }
        break;

      // ── Message editing (item 16) ──────────────────────────────────────────
      case 'editMessage': {
        // Find the N-th user message in history (0-based), truncate after it, re-send
        const targetIdx = m.msgIdx ?? -1;
        if (targetIdx < 0 || !m.newText?.trim()) { break; }
        let userCount = -1;
        let historyPos = -1;
        for (let i = 0; i < this.history.length; i++) {
          if (this.history[i].role === 'user') {
            userCount++;
            if (userCount === targetIdx) { historyPos = i; break; }
          }
        }
        if (historyPos === -1) { break; }
        // Keep system[0] + everything before this user message
        this.history = this.history.slice(0, historyPos);
        this._depth = 0;
        this._lastCallKey = '';
        this._currentDecision = null;
        this._activeModel = this.model;
        this.chat(m.newText, this.model).catch((e: unknown) =>
          this.post({ type: 'error', msg: 'Edit error: ' + (e instanceof Error ? e.message : String(e)) })
        );
        break;
      }

      // ── Regenerate last response (item 18) ────────────────────────────────
      case 'regenerate': {
        // Pop the last assistant turn (and any trailing tool turns)
        while (this.history.length > 1 && this.history[this.history.length - 1].role !== 'user') {
          this.history.pop();
        }
        this._depth = 0;
        this._lastCallKey = '';
        this.chat('', this._activeModel).catch((e: unknown) =>
          this.post({ type: 'error', msg: 'Regenerate error: ' + (e instanceof Error ? e.message : String(e)) })
        );
        break;
      }

      // ── Pin response to memory (item 18) ───────────────────────────────────
      case 'pin': {
        const snippet = (m.content ?? '').slice(0, 500);
        if (!snippet) { break; }
        const key = 'pinned_' + Date.now();
        this.mem.saveFact(key, snippet).then(() =>
          this.post({ type: 'info', msg: `📌 Pinned to memory as **${key}**` })
        );
        break;
      }

      // ── Item 26: Generate commit message from staged diff ─────────────────
      case 'generateCommit':
        this.handleGenerateCommit().catch((e: unknown) =>
          this.post({ type: 'info', msg: '⚠ Commit generation error: ' + (e instanceof Error ? e.message : String(e)) })
        );
        break;

      // ── Item 27: Fork / branch conversation from a past message ──────────
      case 'forkSession':
        if (m.msgIdx !== undefined && m.msgIdx >= 0) {
          this.handleForkSession(m.msgIdx).catch((e: unknown) =>
            this.post({ type: 'info', msg: '⚠ Fork error: ' + (e instanceof Error ? e.message : String(e)) })
          );
        }
        break;
    }
  }

  // ── Item 26: Commit message generation ─────────────────────────────────────
  private async handleGenerateCommit(): Promise<void> {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) { this.post({ type: 'info', msg: '⚠ No workspace folder open.' }); return; }

    this.post({ type: 'info', msg: '⏳ Reading staged diff…' });
    const diff = await gitDiffTool({ staged: true, cwd: wsRoot });

    if (!diff || diff.startsWith('git error:') || diff.startsWith('(no staged')) {
      this.post({
        type: 'info',
        msg: '⚠ No staged changes found. Stage files with `git add` first, then run `/commit` again.',
      });
      return;
    }

    const cfg = vscode.workspace.getConfiguration('deskAssistant');
    const summaryModel = cfg.get<string>('summaryModel', 'llama3.2:latest');

    const prompt =
      'You are a commit message generator. Write a concise Conventional Commits message for this diff.\n\n' +
      'Rules:\n' +
      '- Format: <type>(<scope>): <short description>\n' +
      '- Types: feat, fix, docs, style, refactor, test, chore, perf\n' +
      '- Keep the subject line ≤72 characters\n' +
      '- Optionally add a brief body (blank line between subject and body)\n' +
      '- Output ONLY the commit message — no explanation, no code fences\n\n' +
      'Diff:\n```diff\n' + diff.slice(0, 4_000) + '\n```';

    const commitMsg = await generateOnce({ model: summaryModel, prompt });
    this.post({ type: 'prefillText', text: commitMsg.trim() });
    this.post({
      type: 'info',
      msg: '✅ Commit message pre-filled in the input box. Edit if needed, then send it to the AI to run `git commit`.',
    });
  }

  // ── Item 27: Fork session from a message index ──────────────────────────────
  private async handleForkSession(msgIdx: number): Promise<void> {
    if (!this.session) { return; }
    const forked = await this.mem.forkSession(this.session.id, msgIdx);
    if (!forked) {
      this.post({ type: 'info', msg: '⚠ Could not fork — session not found.' });
      return;
    }
    await this.loadSession(forked.id);
    this.post({ type: 'info', msg: `🌿 Branched from message ${msgIdx + 1}. New session started.` });
  }

  private async loadSession(id: string): Promise<void> {
    const s = await this.mem.loadSession(id);
    if (!s) { return; }
    this.session = s;
    this.model   = s.model;
    // Rebuild in-memory history from session messages (skip system prompt — rebuilt on chat())
    this.history = [];
    this._depth  = 0;
    this._lastCallKey = '';
    // Rebuild in-memory history from session so the AI has full context
    this.history = s.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    // Replay messages into webview
    this._view?.webview.postMessage({ type: 'clearChat' });
    for (const msg of s.messages) {
      this._view?.webview.postMessage({ type: 'restoreMessage', role: msg.role, content: msg.content });
    }
    this._view?.webview.postMessage({ type: 'modelChanged', model: s.model });
    this.sendSessions();
    warmupModel(s.model);
  }

  private handleGetFiles(prefix: string) {
    // Use live workspaceIndex if ready; fall back to a quick findFiles scan
    if (workspaceIndex.ready) {
      const list = workspaceIndex.query(prefix, 30);
      this.post({ type: 'files', list });
    } else {
      vscode.workspace.findFiles('**/*', '**/node_modules/**', 200).then(files => {
        const root = (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '').replace(/\\/g, '/');
        const list = files
          .map(f => {
            let rel = f.fsPath.replace(/\\/g, '/');
            if (root) { rel = rel.replace(root + '/', ''); }
            return rel;
          })
          .filter(f =>
            !f.includes('node_modules') && !f.includes('.git') &&
            (prefix ? f.toLowerCase().includes(prefix.toLowerCase()) : true)
          );
        this.post({ type: 'files', list: list.slice(0, 30) });
      });
    }
  }

  /**
   * Strip @mentions from the user text (their file content is injected by contextBuilder).
   * Returns the cleaned text.
   */
  private stripAtMentions(text: string): string {
    return text.replace(/@[\w./\\-]+/g, '').trim();
  }

  /** Short snippet (first 800 chars) of the active editor file, for the router classify prompt. */
  private getActiveFileSnippet(): { snippet: string; path: string } {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return { snippet: '', path: '' }; }
    const doc = editor.document;
    const ws = (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '').replace(/\\/g, '/');
    let rel = doc.uri.fsPath.replace(/\\/g, '/');
    if (ws) { rel = rel.replace(ws + '/', ''); }
    return { snippet: doc.getText().slice(0, 800), path: rel };
  }

  private _depth = 0;
  private _lastCallKey = '';

  /**
   * runRouter — run the model router for a new user message.
   *
   * Asks marco-o1 (or keyword fallback) to classify the intent, pick the best
   * specialist model, and emit routing info to the webview.  Also rebuilds
   * history[0] with an intent-aware system prompt and unloads the router model
   * from VRAM so the specialist can load cleanly.
   *
   * Only invoked at conversation depth 0 when there is an actual user message.
   */
  private async runRouter(
    text: string,
    cfg:  vscode.WorkspaceConfiguration,
    root: string,
  ): Promise<void> {
    try {
      const { snippet: activeFileSnippet, path: activeFilePath } = this.getActiveFileSnippet();
      const diagnosticsSummary = getDiagnosticsSummary();

      const decision = await modelRouter.route(text, {
        activeFileSnippet,
        diagnosticsSummary,
        availableModels: this._availableModels,
      });

      this._currentDecision = decision;
      this._activeModel     = decision.model;

      auditLog(
        'ROUTE',
        `intent=${decision.intent} model=${decision.model} conf=${Math.round(decision.confidence * 100)}%`,
      );

      // Unload the router model from VRAM and WAIT for confirmation before
      // continuing — on low-RAM machines the specialist cannot load until the
      // router has actually freed its memory.
      const routerModel = cfg.get<string>('routerModel', 'marco-o1:latest');
      if (decision.model !== routerModel) {
        await unloadModel(routerModel);
      }

      // Show routing info bubble in chat UI
      if (cfg.get<boolean>('showRoutingInfo', true)) {
        this.post({
          type:       'routeInfo',
          intent:     decision.intent,
          model:      decision.model,
          confidence: decision.confidence,
          reasoning:  decision.reasoning,
        });
      }

      // Build an intent-aware system prompt and set it as history[0]
      const memorySummary  = await this.mem.getMemorySummary(text);
      const projectContext = await this.mem.getProjectContext();
      const diagnostics    = getDiagnosticsContext();

      const sysContent = buildSystemPrompt({
        workspaceRoot:  root,
        memorySummary,
        projectContext: projectContext || undefined,
        activeFile:     activeFilePath || undefined,
        diagnostics:    diagnostics || undefined,
        intent:         decision.intent,
        enabledTools:   decision.useTools,
      } satisfies SystemPromptOptions);

      if (this.history.length === 0) {
        this.history.push({ role: 'system', content: sysContent });
      } else {
        this.history[0] = { role: 'system', content: sysContent };
      }

    } catch {
      // Router failed — degrade gracefully to the default model
      this._currentDecision = null;
    }
  }

  /**
   * Item 19 — Context compression at 80% num_ctx.
   *
   * Estimates the total character count of all history messages, converts to a
   * rough token estimate (chars / 4), and if it exceeds 80% of numCtx, calls
   * the summaryModel to produce a concise <summary> of the middle messages.
   * The middle messages are then replaced by a single assistant message
   * containing that summary, keeping history[0] (system) and the most recent
   * 4 turns intact.
   */
  private async compressHistory(numCtx: number, cfg: vscode.WorkspaceConfiguration): Promise<void> {
    if (this.history.length < 4) { return; } // nothing to compress

    // Rough token estimate: 1 token ≈ 4 chars
    const CHARS_PER_TOKEN = 4;
    const threshold = numCtx * 0.8 * CHARS_PER_TOKEN; // 80% numCtx in chars

    const totalChars = this.history.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars <= threshold) { return; } // still within budget

    // Keep: history[0] (system), last 4 messages. Summarise everything in between.
    const keep = 4;
    const sys   = this.history[0];
    const tail  = this.history.slice(-keep);
    const middle = this.history.slice(1, this.history.length - keep);
    if (middle.length === 0) { return; }

    auditLog('COMPRESS', `Compressing ${middle.length} messages (${totalChars} chars > ${threshold} threshold)`);

    const summaryModel = cfg.get<string>('summaryModel', 'llama3.2:latest');
    const prompt =
      'Summarise the following conversation in 3–5 sentences. Preserve key facts, decisions and code references.\n\n' +
      middle.map(m => `[${m.role}]: ${m.content}`).join('\n\n');

    try {
      const result = await generateOnce({
        model: summaryModel,
        prompt,
        options: { temperature: 0.2, num_predict: 300 },
      });
      const summaryText = `<summary>\n${result.trim()}\n</summary>`;
      this.history = [sys, { role: 'assistant', content: summaryText }, ...tail];
      auditLog('COMPRESS', `Done — history reduced to ${this.history.length} messages`);
    } catch {
      // Summarisation failed — just trim aggressively instead
      this.history = [sys, ...tail];
      auditLog('COMPRESS', 'Summary model failed — hard-trimmed to last 4 messages');
    }
  }

  // ── Item 29: Request queuing ─────────────────────────────────────────────
  private async runNextInQueue(): Promise<void> {
    if (this._busy || this._queue.length === 0) { return; }
    this._busy = true;
    const next = this._queue.shift()!;
    this._depth = 0;
    this._lastCallKey = '';
    try {
      await this.chat(next.text, this.model);
    } catch (e: unknown) {
      this.post({ type: 'error', msg: 'Fatal: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      this._busy = false;
      // Chain: process next queued message if any
      this.runNextInQueue();
    }
  }

  private async chat(text: string, model?: string): Promise<void> {
    // ── Guard: prevent infinite agentic loops ───────────────────────────────
    if (this._depth > 8) {
      this.post({ type: 'error', msg: 'Tool loop limit reached (8 steps). Stopping to prevent infinite recursion.' });
      this.post({ type: 'done' });
      this._depth = 0;
      return;
    }

    const cfg  = vscode.workspace.getConfiguration('deskAssistant');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // At depth 0 with an explicit model override, reset the active model
    if (this._depth === 0 && model) {
      this._activeModel = model;
    }

    // ── 1. Ensure session exists ─────────────────────────────────────────────
    if (!this.session) {
      this.session = await this.mem.createSession(this._activeModel);
      this.sendSessions();
    }

    // ── 2. Route the first user message via the model router ─────────────────
    //    runRouter() updates this._activeModel to the specialist and rebuilds
    //    history[0] with an intent-aware system prompt.
    if (this._depth === 0 && text && cfg.get<boolean>('enableRouter', true)) {
      await this.runRouter(text, cfg, root);
    }

    // ── 3. Ensure history[0] is a system prompt ──────────────────────────────
    //    Fallback for when the router is disabled or was not invoked.
    if (this.history.length === 0) {
      const memorySummary  = await this.mem.getMemorySummary(text);
      const projectContext = await this.mem.getProjectContext();
      this.history.push({
        role: 'system',
        content: buildSystemPrompt({ workspaceRoot: root, memorySummary, projectContext: projectContext || undefined }),
      });
    }

    // ── 4. Append the user message with smart workspace context ──────────────
    if (text) {
      const ctx         = await contextBuilder.build(text, this._currentDecision?.intent);
      const bareText    = this.stripAtMentions(text);
      const userContent = ctx.combined ? bareText + ctx.combined : bareText;
      this.history.push({ role: 'user', content: userContent });

      // Auto-title the session from the first real user message
      if (this.session.messages.length === 0) {
        this.session = await this.mem.autoTitleSession(this.session, text);
        this.sendSessions();
      }
      await this.mem.appendToSession(this.session, 'user', text);
    }

    // ── 5. Trim history to maxHistoryTurns to prevent silent context overflow ─
    const maxTurns = cfg.get<number>('maxHistoryTurns', 50);
    if (this.history.length > maxTurns * 2 + 1) {
      const sys = this.history[0];
      this.history = [sys, ...this.history.slice(-(maxTurns * 2))];
    }

    // ── 6. Compress context when near the numCtx token limit ─────────────────
    const numCtx = cfg.get<number>('numCtx', 8192);
    await this.compressHistory(numCtx, cfg);

    // ── 7. Stream response from the specialist model ──────────────────────────
    this.abort = new AbortController();
    this.post({ type: 'modelForMessage', model: this._activeModel });
    this.post({ type: 'streamStart' });

    let fullResponse = '';
    try {
      fullResponse = await streamChat(
        this._activeModel,
        this.history,
        d => this.post({ type: 'token', d }),
        this.abort.signal,
        (evalCount, promptEvalCount) =>
          this.post({ type: 'tokenUsage', used: evalCount + promptEvalCount, context: evalCount, total: numCtx }),
      );
    } catch (e: unknown) {
      const errMsg    = e instanceof Error ? e.message : String(e);
      const cancelled = errMsg.toLowerCase().includes('abort');
      this.post({ type: 'streamEnd', cancelled });
      if (!cancelled) { this.post({ type: 'error', msg: errMsg }); }
      this.post({ type: 'done' });
      this._depth = 0;
      return;
    }

    this.post({ type: 'streamEnd', cancelled: false });

    // ── 8. Extract and display <think> / <Thought> blocks ────────────────────
    const { blocks: thinkBlocks, stripped } = extractThinking(fullResponse);
    for (const t of thinkBlocks) {
      this.post({ type: 'thinking', text: t });
    }

    // ── 9. Parse a tool call from the non-thinking portion ───────────────────
    const call = stripped ? parseToolCall(stripped) : null;

    // ── 10a. No tool call → plain text response → finished ───────────────────
    if (!call) {
      if (!stripped) {
        // Model output only a <think> block with no action or answer.
        // Nudge once (depth 0→1). After that, use the think content as the reply.
        if (this._depth === 0) {
          this.history.push({ role: 'assistant', content: fullResponse });
          this.history.push({
            role: 'user',
            content: "You've reasoned through the task. Now act — call the appropriate tool, or give your final answer.",
          });
          this._depth++;
          await this.chat('');
          return;
        }
        const fallback = fullResponse.replace(/<\/?(?:think|[Tt]hought)>/g, '').trim();
        this.history.push({ role: 'assistant', content: fallback || fullResponse });
        await this.mem.appendToSession(this.session!, 'assistant', fallback || fullResponse);
        this.post({ type: 'done' });
        this._depth = 0;
        return;
      }

      this.history.push({ role: 'assistant', content: fullResponse });
      await this.mem.appendToSession(this.session!, 'assistant', stripped);
      this.post({ type: 'done' });
      this._depth = 0;
      return;
    }

    // ── 10b. Tool call detected ───────────────────────────────────────────────
    // De-duplicate: if the model repeats the same call, stop the loop.
    const callKey = `${call.tool}::${JSON.stringify(call.args)}`;
    if (callKey === this._lastCallKey) {
      this.history.push({ role: 'assistant', content: fullResponse });
      this.post({ type: 'error', msg: 'Repeated identical tool call blocked — stopping loop.' });
      this.post({ type: 'done' });
      this._depth = 0;
      this._lastCallKey = '';
      return;
    }
    this._lastCallKey = callKey;

    this.history.push({ role: 'assistant', content: fullResponse });
    this.post({ type: 'tool', name: call.tool, args: call.args });

    // ── 11. Execute the tool ──────────────────────────────────────────────────
    let result: string;
    try {
      result = await executeToolCall(
        call,
        this.confirm.bind(this),
        this.simpleConfirm.bind(this),
        this.mem,
      );
    } catch (e: unknown) {
      result = 'Tool execution error: ' + (e instanceof Error ? e.message : String(e));
    }

    this.post({ type: 'result', text: result });

    // ── 12. Feed result back and continue the agentic loop ───────────────────
    this.history.push({
      role: 'user',
      content:
        `<tool_result>\n${result}\n</tool_result>\n\n` +
        'Tool completed. Use <think> to assess: is the task fully done? ' +
        'If yes, give a short confirmation. If more steps are needed, call the next tool now.',
    });
    this._depth++;
    await this.chat('');
  }

  private guessLanguage(filePath: string): string {
    const ext = (filePath.split('.').pop() ?? '').toLowerCase();
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
      py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html',
      sh: 'shellscript', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
    };
    return map[ext] ?? 'plaintext';
  }

  private async confirm(title: string, filePath: string, before: string, after: string): Promise<boolean> {
    const autoApprove = vscode.workspace.getConfiguration('deskAssistant')
      .get<boolean>('autoApproveEdits', false);
    if (autoApprove) {
      auditLog('WRITE', `Auto-approved: ${title} — ${filePath}`);
      return true;
    }
    // Post the in-chat confirm bubble FIRST before doing anything else.
    // We intentionally do NOT auto-open vscode.diff because it steals focus
    // from the sidebar – the user would be staring at the diff editor while the
    // Yes/No buttons are sitting invisible in the chat panel.
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise(res => {
      this.pending.set(id, res);
      this.post({ type: 'confirmReq', id, title, filePath, before, after });
    });
  }

  private simpleConfirm(title: string, detail: string): Promise<boolean> {
    const autoApprove = vscode.workspace.getConfiguration('deskAssistant')
      .get<boolean>('autoApproveEdits', false);
    if (autoApprove) {
      auditLog('WRITE', `Auto-approved: ${title}`);
      return Promise.resolve(true);
    }
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise(res => {
      this.pending.set(id, res);
      this.post({ type: 'simpleConfirmReq', id, title, detail });
    });
  }

  /** Pre-fill the chat input and focus it — used by code-action commands. */
  public openWithText(text: string): void {
    vscode.commands.executeCommand('deskAssistant.chatView.focus');
    this.post({ type: 'prefillText', text });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const uri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'webview', f));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'">
  <link rel="stylesheet" href="${uri('styles.css')}">
  <link rel="stylesheet" href="${uri('hljs-dark.min.css')}">
</head>
<body>
  <!-- Header -->
  <div id="header">
    <button id="history-toggle" title="Chat history" aria-label="Toggle session history">☰</button>
    <span id="title">Desk Assistant</span>
    <div id="controls">
      <select id="model" title="Select model"></select>
      <button id="new-chat" title="New chat (Ctrl+N)">＋</button>
    </div>
  </div>

  <!-- Session history panel (slide-in) -->
  <div id="session-panel" class="hidden">
    <div id="session-header">
      <span>Chat History</span>
      <button id="session-close" title="Close">✕</button>
    </div>
    <div id="session-list"></div>
  </div>

  <!-- Workspace indicator -->
  <div id="ws-bar"><span id="ws-path">loading…</span></div>

  <!-- Message area -->
  <div id="msgs">
    <div id="welcome">
      <div class="welcome-icon">✦</div>
      <div class="welcome-title">Desk Assistant</div>
      <div class="welcome-sub">Powered by Ollama · Fully local</div>
      <div class="welcome-hints">
        <div class="hint">Ask about your code or say <kbd>/help</kbd></div>
        <div class="hint">Type <kbd>@</kbd> to mention a file</div>
        <div class="hint">Press <kbd>Ctrl+N</kbd> to start a new chat</div>
      </div>
    </div>
  </div>

  <!-- Footer / input -->
  <div id="foot">
    <div id="token-bar" class="hidden" title="Token usage"></div>
    <div id="templates-bar">
      <button class="tpl-btn" data-tpl="Explain the selected code:">Explain</button>
      <button class="tpl-btn" data-tpl="Write tests for:">Test</button>
      <button class="tpl-btn" data-tpl="Refactor this to be cleaner and more idiomatic:">Refactor</button>
      <button class="tpl-btn" data-tpl="Debug this — find and fix the issue:">Debug</button>
      <button class="tpl-btn" data-tpl="Review this code for bugs, security and performance issues:">Review</button>
      <button class="tpl-btn" data-tpl="Write JSDoc/docstring documentation for:">Docs</button>
    </div>
    <div id="at-dropdown" class="hidden"></div>
    <div id="inp-wrap">
      <textarea id="inp"
        placeholder="Ask anything… (Enter to send · Shift+Enter newline · /help)"
        rows="1"></textarea>
    </div>
    <div id="btns">
      <span id="char-count"></span>
      <button id="stop" class="hidden" title="Stop generation">■ Stop</button>
      <button id="send" title="Send (Enter)">Send ↵</button>
    </div>
  </div>
  <script nonce="${nonce}" src="${uri('highlight.min.js')}"></script>
  <script nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
}
