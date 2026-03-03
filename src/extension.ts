import * as vscode from 'vscode';
import { ChatViewProvider } from './chatPanel';
import { listModels, healthCheck, generateOnce } from './ollamaClient';
import { registerCompletionProvider } from './completionProvider';
import { registerCodeActionsProvider } from './diagnosticsProvider';
import { workspaceIndex } from './workspaceIndex';
import { initAuditLog } from './auditLog';

export function activate(context: vscode.ExtensionContext) {
  // ── Audit log output channel ────────────────────────────────────────
  initAuditLog();

  const provider = new ChatViewProvider(context);

  // ── Workspace file + symbol index ───────────────────────────────────────
  workspaceIndex.init(context);  // async, runs in background

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('deskAssistant.chatView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const openCmd = vscode.commands.registerCommand('deskAssistant.openChat', () => {
    vscode.commands.executeCommand('deskAssistant.chatView.focus');
  });

  const newChatCmd = vscode.commands.registerCommand('deskAssistant.newChat', () => {
    provider.newChat();
  });

  const pickCmd = vscode.commands.registerCommand('deskAssistant.pickModel', async () => {
    const models = await listModels();
    if (!models.length) {
      vscode.window.showWarningMessage('No Ollama models found. Is Ollama running?');
      return;
    }
    const picked = await vscode.window.showQuickPick(models, { placeHolder: 'Select model' });
    if (picked) {
      await vscode.workspace.getConfiguration('deskAssistant')
        .update('defaultModel', picked, vscode.ConfigurationTarget.Global);
      provider.setModel(picked);
    }
  });

  // ── Status bar: live Ollama connection indicator ───────────────────────────
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  bar.command = 'deskAssistant.openChat';
  bar.show();

  async function updateBar() {
    const ok = await healthCheck();
    if (ok) {
      bar.text    = '$(hubot) Desk';
      bar.tooltip = 'Desk Assistant — Ollama online';
      bar.backgroundColor = undefined;
    } else {
      bar.text    = '$(warning) Desk';
      bar.tooltip = 'Desk Assistant — Ollama offline (start Ollama to connect)';
      bar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }

  updateBar();
  const statusPoll = setInterval(updateBar, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(statusPoll) });

  // ── Code action commands ("Fix with Desk Assistant" / "Explain: ...") ──────
  const fixErrorCmd = vscode.commands.registerCommand(
    'deskAssistant.fixError',
    (msg: string, lineText: string, filePath: string) => {
      const prompt = `Fix this error in ${filePath}:\n\nError: ${msg}\n\nCode: ${lineText}`;
      provider.openWithText(prompt);
    }
  );

  const explainErrorCmd = vscode.commands.registerCommand(
    'deskAssistant.explainError',
    (msg: string, lineText: string, filePath: string) => {
      const prompt = `Explain this error in ${filePath}:\n\nError: ${msg}\n\nCode: ${lineText}`;
      provider.openWithText(prompt);
    }
  );

  context.subscriptions.push(openCmd, newChatCmd, pickCmd, bar, fixErrorCmd, explainErrorCmd);

  // ── Item 30: Model benchmarking command ──────────────────────────────────
  const benchmarkCmd = vscode.commands.registerCommand('deskAssistant.benchmarkModels', async () => {
    const models = await listModels();
    if (!models.length) {
      vscode.window.showWarningMessage('Desk Assistant: No Ollama models found. Is Ollama running?');
      return;
    }

    const channel = vscode.window.createOutputChannel('Desk Benchmark', { log: false });
    channel.show(true);
    channel.appendLine('=══════════════════════════════════════════=');
    channel.appendLine(' Desk Assistant — Model Benchmark');
    channel.appendLine('=══════════════════════════════════════════=');
    channel.appendLine(`Testing ${models.length} model(s) — ${new Date().toLocaleString()}`);
    channel.appendLine('');

    const BENCH_PROMPT = 'Write a TypeScript function named fibonacci(n: number): number that computes the nth Fibonacci number recursively. Return ONLY the function, no explanation.';
    const results: Array<{ model: string; ms: number; chars: number; tps: number; ok: boolean }> = [];

    for (const model of models) {
      channel.appendLine(`  ▶ ${model} …`);
      const t0 = Date.now();
      try {
        const resp = await Promise.race([
          generateOnce({ model, prompt: BENCH_PROMPT }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('timeout after 60 s')), 60_000)
          ),
        ]);
        const ms = Date.now() - t0;
        const chars = resp.length;
        // Rough token estimate: ~4 chars/token
        const tps = chars > 0 ? Math.round(chars / 4 / (ms / 1000)) : 0;
        results.push({ model, ms, chars, tps, ok: true });
        channel.appendLine(`    ✓ ${ms} ms  |  ~${tps} tok/s  |  ${chars} chars`);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        results.push({ model, ms: Date.now() - t0, chars: 0, tps: 0, ok: false });
        channel.appendLine(`    ✗ FAILED: ${errMsg}`);
      }
      channel.appendLine('');
    }

    // Summary table
    channel.appendLine('=══════════════════════════════════════════=');
    channel.appendLine(' Results (sorted fastest → slowest)');
    channel.appendLine('=══════════════════════════════════════════=');
    const ranked = [...results].sort((a, b) => {
      if (a.ok !== b.ok) { return a.ok ? -1 : 1; }
      return a.ms - b.ms;
    });
    ranked.forEach((r, i) => {
      const status = r.ok ? `${r.ms} ms  (~${r.tps} tok/s)` : 'FAILED';
      channel.appendLine(`  ${i + 1}. ${r.model}: ${status}`);
    });
    channel.appendLine('');
  });

  context.subscriptions.push(benchmarkCmd);

  // ── Diagnostics code-action provider ─────────────────────────────────────
  registerCodeActionsProvider(context);

  // ── Phase 6: inline ghost-text completions ─────────────────────────────────
  registerCompletionProvider(context);

  healthCheck().then(ok => {
    if (!ok) {
      vscode.window.showWarningMessage('Desk Assistant: Ollama not reachable. Start Ollama first.');
    }
  });
}

export function deactivate() {}

