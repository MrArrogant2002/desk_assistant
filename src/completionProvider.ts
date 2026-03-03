import * as vscode from 'vscode';

// FIM (fill-in-the-middle) capable model families.
// These support special <PRE>/<SUF>/<MID> tokens for better completion quality.
const FIM_FAMILIES = ['codellama', 'deepseek-coder', 'qwen2.5-coder', 'starcoder', 'codegemma'];

function baseUrl(): string {
  return vscode.workspace.getConfiguration('deskAssistant')
    .get<string>('ollamaBaseUrl', 'http://localhost:11434');
}

function isFimModel(model: string): boolean {
  const lower = model.toLowerCase();
  return FIM_FAMILIES.some(f => lower.includes(f));
}

// Cache last result so repeat calls with the same position return instantly.
let _cachePos: string | null = null;
let _cacheResult: vscode.InlineCompletionList = { items: [] };

export function registerCompletionProvider(context: vscode.ExtensionContext): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelController: AbortController | null = null;

  const provider: vscode.InlineCompletionItemProvider = {
    provideInlineCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      _context: vscode.InlineCompletionContext,
      token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList> {
      const cfg = vscode.workspace.getConfiguration('deskAssistant');
      if (!cfg.get<boolean>('enableInlineCompletions', false)) {
        return Promise.resolve({ items: [] });
      }

      const model      = cfg.get<string>('completionModel', 'qwen2.5-coder:1.5b');
      const debounceMs = cfg.get<number>('completionDebounceMs', 600);
      const maxLines   = cfg.get<number>('completionMaxLines', 20);

      // Return cache if cursor hasn't moved
      const posKey = `${document.uri}:${position.line}:${position.character}`;
      if (posKey === _cachePos) { return Promise.resolve(_cacheResult); }

      return new Promise<vscode.InlineCompletionList>(resolve => {
        if (debounceTimer) { clearTimeout(debounceTimer); }

        debounceTimer = setTimeout(async () => {
          if (token.isCancellationRequested) { resolve({ items: [] }); return; }

          // Cancel any previous in-flight request
          cancelController?.abort();
          cancelController = new AbortController();
          const aborter = cancelController;

          try {
            // ── Build context window ───────────────────────────────────────
            const startLine = Math.max(0, position.line - maxLines);
            const beforeParts: string[] = [];
            for (let i = startLine; i <= position.line; i++) {
              const lineText = document.lineAt(i).text;
              beforeParts.push(i === position.line
                ? lineText.slice(0, position.character)
                : lineText);
            }

            const afterParts: string[] = [];
            const lineCount = document.lineCount;
            for (let i = position.line + 1; i < Math.min(lineCount, position.line + 6); i++) {
              afterParts.push(document.lineAt(i).text);
            }

            const before   = beforeParts.join('\n');
            const after    = afterParts.join('\n');
            const langId   = document.languageId;
            const fileName = document.fileName.split(/[/\\]/).pop() ?? '';

            // ── Build prompt ──────────────────────────────────────────────
            let prompt: string;
            if (isFimModel(model)) {
              // FIM format: model fills the gap between PRE and SUF at MID
              prompt = `<PRE>${before}<SUF>\n${after}\n<MID>`;
            } else {
              prompt = `// File: ${fileName}\n// Language: ${langId}\n// Complete the following code:\n${before}`;
            }

            // ── Request completion ────────────────────────────────────────
            const r = await fetch(baseUrl() + '/api/generate', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: {
                  num_predict: 80,
                  temperature: 0.1,
                  // Stop generation at natural code boundaries
                  stop: ['\n\n', '\nfunction ', '\nclass ', '\ndef ', '\n}', '\n```'],
                },
              }),
              signal: aborter.signal,
            });

            if (!r.ok || token.isCancellationRequested) { resolve({ items: [] }); return; }

            const d         = await r.json() as { response?: string };
            const completion = (d.response ?? '').trimEnd();
            if (!completion) { resolve({ items: [] }); return; }

            const result: vscode.InlineCompletionList = {
              items: [{
                insertText: completion,
                range: new vscode.Range(position, position),
              }],
            };

            // Update cache
            _cachePos    = posKey;
            _cacheResult = result;

            resolve(result);
          } catch {
            resolve({ items: [] });
          }
        }, debounceMs);
      });
    },
  };

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },   // all languages + files
      provider
    )
  );
}
