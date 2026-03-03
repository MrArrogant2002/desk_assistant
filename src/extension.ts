import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { listModels, healthCheck } from './ollamaClient';

export function activate(context: vscode.ExtensionContext) {
  const openCmd = vscode.commands.registerCommand('deskAssistant.openChat', () => {
    ChatPanel.createOrShow(context);
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
      ChatPanel.updateModel(picked);
    }
  });

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  bar.text = '$(hubot) Desk Assistant';
  bar.command = 'deskAssistant.openChat';
  bar.tooltip = 'Open Desk Assistant';
  bar.show();

  context.subscriptions.push(openCmd, pickCmd, bar);

  healthCheck().then(ok => {
    if (!ok) {
      vscode.window.showWarningMessage('Desk Assistant: Ollama not reachable. Start Ollama first.');
    }
  });
}

export function deactivate() {}
