import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { SimpleConfirmFn } from '../confirmationProvider';
import { auditLog } from '../auditLog';

// Default blocklist — catastrophic / destructive commands that should never run.
const DEFAULT_BLOCKLIST = [
  'rm -rf /',
  'rm -rf ~',
  'format c',
  'format c:',
  'dd if=',
  'mkfs',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
  '> /dev/sda',
  'del /f /s /q c:\\',
];

function isBlocked(command: string, blocklist: string[]): string | null {
  const lower = command.toLowerCase().replace(/\s+/g, ' ');
  for (const pattern of blocklist) {
    if (lower.includes(pattern.toLowerCase())) { return pattern; }
  }
  return null;
}

export async function runTerminalTool(
  args: { command: string; cwd?: string },
  confirm: SimpleConfirmFn
): Promise<string> {
  // ── Blocklist check (before confirmation) ──────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('deskAssistant');
  const userBlocklist = cfg.get<string[]>('terminalBlocklist', []);
  const blocklist = [...DEFAULT_BLOCKLIST, ...userBlocklist];
  const blocked = isBlocked(args.command, blocklist);
  if (blocked) {
    auditLog('BLOCKED', `Terminal command blocked by pattern "${blocked}": ${args.command}`);
    return `Error: Command blocked by safety blocklist (matched pattern: "${blocked}"). Command not executed.`;
  }

  auditLog('TERMINAL', args.command);
  if (!await confirm('Run command', args.command)) { return 'Skipped by user.'; }

  // Resolve working directory — prefer arg, then workspace root
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = args.cwd
    ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(wsRoot ?? '.', args.cwd))
    : (wsRoot ?? process.cwd());

  // Also echo to the visible terminal so the user can see it
  const term = vscode.window.terminals.find(t => t.name === 'Desk Assistant')
    ?? vscode.window.createTerminal({ name: 'Desk Assistant', cwd });
  term.sendText(args.command);
  term.show();

  // Actually execute and capture output
  return new Promise(resolve => {
    cp.exec(
      args.command,
      { cwd, timeout: 30_000, maxBuffer: 512 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' },
      (err, stdout, stderr) => {
        const out = (stdout || '').trim();
        const err2 = (stderr || '').trim();
        if (err && !out && !err2) {
          resolve(`Exit code ${err.code ?? '?'}: ${err.message}`);
          return;
        }
        const parts: string[] = [];
        if (out)  { parts.push(out); }
        if (err2) { parts.push('[stderr]\n' + err2); }
        if (err)  { parts.push(`[exit code ${err.code ?? '?'}]`); }
        resolve(parts.join('\n') || '(no output)');
      }
    );
  });
}
