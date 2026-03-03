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
    const r = await fetch(baseUrl() + '/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) { return []; }
    const d = await r.json() as { models: { name: string }[] };
    return (d.models ?? []).map(m => m.name);
  } catch { return []; }
}

/**
 * Pre-warm a model: sends a zero-token request with keep_alive so Ollama loads
 * the model into VRAM immediately, giving near-instant first token on real requests.
 */
export async function warmupModel(model: string): Promise<void> {
  try {
    await fetch(baseUrl() + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', keep_alive: -1, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { /* warmup is best-effort */ }
}

/**
 * Unload a model from VRAM immediately by setting keep_alive to 0.
 * Call this after using a routing model (marco-o1) so the specialist model
 * can load without competing for VRAM.
 */
export async function unloadModel(model: string): Promise<void> {
  try {
    await fetch(baseUrl() + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', keep_alive: 0, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { /* unload is best-effort */ }
}

/**
 * Non-streaming generate — used by the model router (marco-o1) to classify intent.
 * Returns the full response string synchronously (from the caller's perspective).
 */
/**
 * Call Ollama's /api/embeddings to get a vector for `text`.
 * Uses whatever model is given — regular chat models (e.g. llama3.2) work fine.
 * Throws if unavailable so callers can fall back gracefully.
 */
export async function getEmbedding(text: string, model: string): Promise<number[]> {
  const r = await fetch(baseUrl() + '/api/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, prompt: text }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!r.ok) { throw new Error(`Ollama embeddings ${r.status}: ${r.statusText}`); }
  const j = await r.json() as { embedding?: number[] };
  if (!j.embedding?.length) { throw new Error('No embedding returned'); }
  return j.embedding;
}

export async function generateOnce(params: {
  model: string;
  prompt: string;
  system?: string;
  options?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const url = baseUrl() + '/api/generate';
  let response: Response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   params.model,
        prompt:  params.prompt,
        system:  params.system ?? '',
        stream:  false,
        options: params.options ?? {},
      }),
      signal: params.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
      throw new Error('Cannot reach Ollama. Is it running? (http://localhost:11434)');
    }
    throw e;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama generate ${response.status}: ${body || response.statusText}`);
  }

  const json = await response.json() as { response?: string; error?: string };
  if (json.error) { throw new Error('Ollama error: ' + json.error); }
  return json.response ?? '';
}

export async function streamChat(
  model: string,
  messages: ChatMessage[],
  onChunk: (t: string) => void,
  signal?: AbortSignal,
  onDone?: (evalCount: number, promptEvalCount: number) => void
): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('deskAssistant');
  const numCtx = cfg.get<number>('numCtx', 8192);

  let response: Response;
  try {
    response = await fetch(baseUrl() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: -1,           // keep model loaded between turns
        options: { num_ctx: numCtx },
      }),
      signal,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
      throw new Error('Cannot reach Ollama. Is it running? (http://localhost:11434)');
    }
    throw e;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new Error(`Model "${model}" not found. Pull it with: ollama pull ${model}`);
    }
    throw new Error(`Ollama ${response.status}: ${body || response.statusText}`);
  }
  if (!response.body) { throw new Error('No response body from Ollama'); }

  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  let buf  = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { break; }
    buf += dec.decode(value, { stream: true });
    // Process all complete newline-delimited JSON objects in buffer
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';   // last item may be incomplete
    for (const line of lines) {
      if (!line.trim()) { continue; }
      try {
        const j = JSON.parse(line) as {
          message?: { content: string };
          error?: string;
          done?: boolean;
          eval_count?: number;
          prompt_eval_count?: number;
        };
        if (j.error) { throw new Error('Ollama error: ' + j.error); }
        if (j.message?.content) {
          full += j.message.content;
          onChunk(j.message.content);
        }
        if (j.done) {
          onDone?.(j.eval_count ?? 0, j.prompt_eval_count ?? 0);
        }
      } catch (parseErr) {
        // Only rethrow real errors, not JSON parse issues
        if (parseErr instanceof Error && parseErr.message.startsWith('Ollama error:')) {
          throw parseErr;
        }
      }
    }
  }
  return full;
}

