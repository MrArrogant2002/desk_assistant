import * as vscode from 'vscode';

// ─── Audit Log ────────────────────────────────────────────────────────────────
// A single VS Code Output Channel that records every significant action the
// extension takes: model routing decisions, tool calls, file writes, and
// terminal commands.  This gives the user a transparent, searchable audit
// trail without cluttering the chat panel.

let channel: vscode.OutputChannel | null = null;

/**
 * Call once from `extension.ts` activate() to create the output channel.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initAuditLog(): void {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Desk Assistant Audit');
  }
}

/**
 * Append a timestamped entry to the audit log output channel.
 * If the channel has not been initialised yet, the message is silently dropped
 * (this can only happen before activate() runs, which should never occur in
 *  normal usage).
 *
 * @param category  Short tag for the log entry, e.g. "ROUTE", "TOOL", "WRITE", "TERMINAL"
 * @param message   Free-text detail.  Automatically truncated to 400 chars.
 */
export function auditLog(category: string, message: string): void {
  if (!channel) { return; }
  const ts  = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const tag = category.toUpperCase().padEnd(10);
  const msg = message.length > 400 ? message.slice(0, 400) + ' …(truncated)' : message;
  channel.appendLine(`[${ts}] [${tag}] ${msg}`);
}
