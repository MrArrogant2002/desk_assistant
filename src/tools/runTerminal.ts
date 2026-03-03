import * as vscode from 'vscode';
import { SimpleConfirmFn } from '../confirmationProvider';

export async function runTerminalTool(
  args: { command: string; cwd?: string },
  confirm: SimpleConfirmFn
): Promise<string> {
  if (!await confirm('Run command', args.command)) { return 'Skipped by user.'; }
  const term = vscode.window.terminals.find(t => t.name === 'Desk Assistant')
    ?? vscode.window.createTerminal({ name: 'Desk Assistant', cwd: args.cwd });
  if (args.cwd) { term.sendText(`cd "${args.cwd}"`); }
  term.sendText(args.command);
  term.show();
  return 'Command sent to terminal.';
}
