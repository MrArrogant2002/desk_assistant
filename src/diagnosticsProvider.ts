import * as vscode from 'vscode';

// ─── Diagnostics context helpers ─────────────────────────────────────────────

/**
 * Returns a human-readable diagnostics summary for the active (or given) file.
 * Used by chatPanel to inject a <diagnostics> block into the system prompt.
 * Includes up to 10 Error+Warning diagnostics.
 */
export function getDiagnosticsContext(uri?: vscode.Uri): string {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) { return ''; }

  const diags = vscode.languages.getDiagnostics(targetUri)
    .filter(d =>
      d.severity === vscode.DiagnosticSeverity.Error ||
      d.severity === vscode.DiagnosticSeverity.Warning
    )
    .slice(0, 10);

  if (!diags.length) { return ''; }

  const ws = (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '').replace(/\\/g, '/');
  let rel = targetUri.fsPath.replace(/\\/g, '/');
  if (ws) { rel = rel.replace(ws + '/', ''); }

  return diags.map(d => {
    const sev  = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
    const line = d.range.start.line + 1;
    const col  = d.range.start.character + 1;
    const src  = d.source ? ` (${d.source})` : '';
    return `[${sev}] ${rel}:${line}:${col} — ${d.message}${src}`;
  }).join('\n');
}

/**
 * Compact version: just file + line + message, for injecting into router prompt.
 */
export function getDiagnosticsSummary(uri?: vscode.Uri): string {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) { return ''; }

  const errors = vscode.languages.getDiagnostics(targetUri)
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
    .slice(0, 5);

  if (!errors.length) { return ''; }

  return errors.map(d => `Line ${d.range.start.line + 1}: ${d.message}`).join('\n');
}

// ─── Code Action Provider ─────────────────────────────────────────────────────

/**
 * Registers "Fix with Desk Assistant" and "Explain this error" code actions
 * that appear on error squiggles throughout the editor.
 */
export function registerCodeActionsProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerCodeActionsProvider(
    { pattern: '**' },
    {
      provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        ctx: vscode.CodeActionContext
      ): vscode.CodeAction[] {
        // Show only for actual Errors (not Warnings/Info — too noisy)
        const errors = ctx.diagnostics.filter(
          d => d.severity === vscode.DiagnosticSeverity.Error
        );
        if (!errors.length) { return []; }

        const ws = (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '').replace(/\\/g, '/');
        let rel = document.uri.fsPath.replace(/\\/g, '/');
        if (ws) { rel = rel.replace(ws + '/', ''); }

        const actions: vscode.CodeAction[] = [];

        for (const diag of errors.slice(0, 3)) {
          const line = diag.range.start.line + 1;
          const shortMsg = diag.message.length > 60
            ? diag.message.slice(0, 60) + '…'
            : diag.message;

          // ── Fix action ──────────────────────────────────────────────────
          const fix = new vscode.CodeAction(
            `Fix with Desk Assistant: ${shortMsg}`,
            vscode.CodeActionKind.QuickFix
          );
          fix.diagnostics  = [diag];
          fix.isPreferred  = true;
          fix.command = {
            command:   'deskAssistant.fixError',
            title:     'Fix with Desk Assistant',
            arguments: [rel, line, diag.message],
          };
          actions.push(fix);

          // ── Explain action ───────────────────────────────────────────────
          const explain = new vscode.CodeAction(
            `Explain: ${shortMsg}`,
            vscode.CodeActionKind.Empty
          );
          explain.diagnostics = [diag];
          explain.command = {
            command:   'deskAssistant.explainError',
            title:     'Explain this error',
            arguments: [rel, line, diag.message],
          };
          actions.push(explain);
        }

        return actions;
      },
    },
    {
      providedCodeActionKinds: [
        vscode.CodeActionKind.QuickFix,
        vscode.CodeActionKind.Empty,
      ],
    }
  );

  context.subscriptions.push(provider);
}
