import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function baseUrl(): string {
  return vscode.workspace.getConfiguration('deskAssistant')
    .get<string>('ollamaBaseUrl', 'http://localhost:11434');
}

export async function healthCheck(): Promise<boolean> {
  try {
    const r = await fetch(baseUrl() + '/api/version', { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

export async function listModels(): Promise<string[]> {
  try {
    const r = await fetch(baseUrl() + '/api/tags');
    if (!r.ok) { return []; }
    const d = await r.json() as { models: { name: string }[] };
    return d.models.map(m => m.name);
  } catch { return []; }
}

export async function streamChat(
  model: string,
  messages: ChatMessage[],
  onChunk: (t: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const r = await fetch(baseUrl() + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!r.ok) { throw new Error('Ollama ' + r.status + ': ' + await r.text()); }
  if (!r.body) { throw new Error('No response body'); }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { break; }
    const chunk = dec.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.trim()) { continue; }
      try {
        const j = JSON.parse(line) as { message?: { content: string } };
        if (j.message?.content) { full += j.message.content; onChunk(j.message.content); }
      } catch { /* incomplete JSON */ }
    }
  }
  return full;
}
