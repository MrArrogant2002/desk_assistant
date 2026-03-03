/**
 * toolEngine.ts
 *
 * Single source of truth for everything tool-related:
 *   - Tool registry (KNOWN_TOOLS)
 *   - Multi-format tool call parser (parseToolCall)
 *   - Thinking-block extractor (extractThinking)
 *   - Tool executor with per-tool timeouts (executeToolCall)
 *
 * chatPanel.ts imports this module and delegates all tool work here.
 * Each individual tool implementation lives in src/tools/.
 */

import { ConfirmFn, SimpleConfirmFn } from './confirmationProvider';
import { MemoryManager } from './memoryManager';
import { auditLog } from './auditLog';

import { readFileTool }    from './tools/readFile';
import { writeFileTool }   from './tools/writeFile';
import { patchCodeTool }   from './tools/patchCode';
import { replaceLinesTool } from './tools/replaceLines';
import { listDirTool }     from './tools/listDir';
import { runTerminalTool } from './tools/runTerminal';
import { saveMemoryTool }  from './tools/saveMemory';
import { queryMemoryTool } from './tools/queryMemory';
import { searchWebTool }   from './tools/searchWeb';
import { gitStatusTool }   from './tools/gitStatus';
import { gitDiffTool }     from './tools/gitDiff';
import { gitLogTool }      from './tools/gitLog';

// ─── Tool registry ────────────────────────────────────────────────────────────

/**
 * All tool names that this engine can execute.
 * The system prompt, parser, and dispatcher all key off this list.
 */
export const KNOWN_TOOLS = [
  'read_file',
  'write_file',
  'patch_code',
  'replace_lines',
  'list_dir',
  'run_terminal',
  'save_memory',
  'query_memory',
  'search_web',
  'git_status',
  'git_diff',
  'git_log',
] as const;

export type KnownTool = (typeof KNOWN_TOOLS)[number];

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

// ─── Per-tool timeouts (ms) ───────────────────────────────────────────────────

const TOOL_TIMEOUT: Record<string, number> = {
  // Interactive file-write tools: 5-minute window so the user has time to
  // read the diff and click "Apply" or "Skip" without hitting a timeout.
  write_file:    300_000,
  patch_code:    300_000,
  replace_lines: 300_000,
  // Terminal: 90 s for the command itself + confirmation click
  run_terminal:   90_000,
  // Network / background ops are faster; no human interaction needed
  search_web:    15_000,
  read_file:     10_000,
  list_dir:       5_000,
  save_memory:    5_000,
  query_memory:   5_000,
  git_status:    10_000,
  git_diff:      15_000,
  git_log:       10_000,
};

// ─── JSON repair helpers ──────────────────────────────────────────────────────

/**
 * Escape raw control characters (newlines, tabs, CR) inside JSON string values.
 * Models frequently embed literal newlines inside string values, which breaks
 * JSON.parse. We scan character-by-character tracked by string context.
 */
function sanitizeJsonStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }

    if (inString) {
      if      (ch === '\n') { out += '\\n'; }
      else if (ch === '\r') { out += '\\r'; }
      else if (ch === '\t') { out += '\\t'; }
      else { out += ch; }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Try several repair strategies; return the parsed object or null. */
function tryParseJson(raw: string): Record<string, unknown> | null {
  const attempts = [
    raw.trim(),
    sanitizeJsonStrings(raw.trim()),
    sanitizeJsonStrings(raw.trim()).replace(/\\(?!["\\/bfnrtu])/g, '\\\\'),
    raw.trim().replace(/\\(?!["\\/bfnrtu])/g, '\\\\'),
  ];
  for (const attempt of attempts) {
    try { return JSON.parse(attempt) as Record<string, unknown>; } catch { /* try next */ }
  }
  return null;
}

/**
 * Extract the first balanced {...} JSON object from `text` starting at `fromIdx`.
 *
 * Unlike a regex, this respects nested braces inside string literals and
 * correctly handles content strings that contain closing braces (e.g. Python/TS code).
 */
function extractJsonObject(text: string, fromIdx = 0): string | null {
  const start = text.indexOf('{', fromIdx);
  if (start === -1) { return null; }

  let depth     = 0;
  let inString  = false;
  let escaped   = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) { continue; }

    if (c === '{') { depth++; }
    else if (c === '}') {
      if (--depth === 0) { return text.slice(start, i + 1); }
    }
  }
  return null;
}

/** Normalise a raw tool name: lower-case, strip "tool" suffix, keep a-z and _. */
function normaliseName(raw: string): string {
  const n = raw.trim().toLowerCase().replace(/tool$/i, '').replace(/[^a-z_]/g, '');
  return (KNOWN_TOOLS as readonly string[]).find(k => n === k || n.startsWith(k)) ?? n;
}

function isKnown(name: string): boolean {
  return (KNOWN_TOOLS as readonly string[]).includes(name);
}

// ─── Multi-format tool call parser ───────────────────────────────────────────

/**
 * Parse a tool call from any format a local LLM might produce.
 *
 * Format priority:
 *  1. JSON object   — {"tool": "x", "args": {...}}
 *  2. XML tool_call  — <tool_call><tool>x</tool><args>{...}</args></tool_call>
 *  3. Loose         — tool_name\n{...}  or  tool_name{...}
 *  4. XML attribute  — <tool_name key="val"/>  (common marco-o1 output)
 *  5. Fenced JSON   — ```json\n{"tool":…}\n```
 *
 * Returns null when no recognisable tool call is found.
 */
export function parseToolCall(text: string): ToolCall | null {
  // ── Format 1: {"tool": "name", "args": {...}} ────────────────────────────
  const raw1 = extractJsonObject(text);
  if (raw1) {
    const obj = tryParseJson(raw1) as { tool?: unknown; args?: unknown } | null;
    if (obj && typeof obj.tool === 'string' && obj.args && typeof obj.args === 'object') {
      const t = normaliseName(obj.tool);
      if (isKnown(t)) {
        return { tool: t, args: obj.args as Record<string, unknown> };
      }
    }
  }

  // ── Format 2: <tool_call> XML block ──────────────────────────────────────
  const xmlBlock = text.match(
    /<tool_call[^>]*>\s*<tool>([\s\S]*?)<\/tool>\s*<args>([\s\S]*?)<\/args>\s*<\/tool_call>/i
  );
  if (xmlBlock) {
    const args = tryParseJson(xmlBlock[2].trim());
    if (args) {
      const t = normaliseName(xmlBlock[1].trim());
      if (isKnown(t)) { return { tool: t, args }; }
    }
  }

  // ── Format 3: loose "tool_name {..." ─────────────────────────────────────
  for (const k of KNOWN_TOOLS) {
    const idx = text.search(new RegExp(k + '(?:tool)?\\s*\\{', 'i'));
    if (idx !== -1) {
      const braceIdx = text.indexOf('{', idx);
      const raw3 = extractJsonObject(text, braceIdx);
      if (raw3) {
        const args = tryParseJson(raw3);
        if (args) { return { tool: k, args }; }
      }
    }
  }

  // ── Format 4: XML attribute style <tool_name key="val" key2="val2"/> ─────
  for (const k of KNOWN_TOOLS) {
    const tagRe = new RegExp('<' + k + '([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/' + k + '>)', 'i');
    const m = text.match(tagRe);
    if (m) {
      const args: Record<string, unknown> = {};
      const attrRe = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[1])) !== null) {
        args[a[1]] = a[2].replace(/\\"/g, '"');
      }
      // write_file can put the content as element body
      if (k === 'write_file' && !args['content']) {
        const bodyM = text.match(/<write_file[^>]*>([\s\S]*?)<\/write_file>/i);
        if (bodyM) { args['content'] = bodyM[1]; }
      }
      if (Object.keys(args).length > 0) { return { tool: k, args }; }
    }
  }

  // ── Format 5: code-fenced JSON ────────────────────────────────────────────
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced) {
    const obj = tryParseJson(fenced[1]) as { tool?: unknown; args?: unknown } | null;
    if (obj && typeof obj.tool === 'string' && obj.args && typeof obj.args === 'object') {
      const t = normaliseName(obj.tool);
      if (isKnown(t)) {
        return { tool: t, args: obj.args as Record<string, unknown> };
      }
    }
  }

  return null;
}

// ─── Thinking-block extractor ─────────────────────────────────────────────────

/**
 * Extract all <think> / <Thought> blocks from `text`.
 * Returns the collected thinking strings and the text with those blocks removed.
 */
export function extractThinking(text: string): { blocks: string[]; stripped: string } {
  const blocks: string[] = [];
  const stripped = text
    .replace(
      /<(?:think|[Tt]hought)>([\s\S]*?)<\/(?:think|[Tt]hought)>/g,
      (_, inner: string) => { blocks.push(inner.trim()); return ''; }
    )
    .trim();
  return { blocks, stripped };
}

// ─── Tool executor ────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Execute a parsed tool call.
 *
 * @param call   The parsed tool call (tool name + args)
 * @param cf     Confirmation callback for destructive file operations
 * @param scf    Simple yes/no confirmation for terminal commands
 * @param mem    MemoryManager instance for save/query_memory tools
 * @returns      A human-readable result string the model can read
 */
export async function executeToolCall(
  call: ToolCall,
  cf:   ConfirmFn,
  scf:  SimpleConfirmFn,
  mem:  MemoryManager,
): Promise<string> {
  auditLog('TOOL', `${call.tool}(${JSON.stringify(call.args).slice(0, 200)})`);

  const execution = ((): Promise<string> => {
    switch (call.tool) {
      case 'read_file':
        return readFileTool(call.args as { path: string });

      case 'write_file':
        return writeFileTool(
          call.args as { path: string; content: string },
          cf,
        );

      case 'patch_code':
        return patchCodeTool(
          call.args as { path: string; search: string; replace: string },
          cf,
        );

      case 'replace_lines':
        return replaceLinesTool(
          call.args as { path: string; start: number; end?: number; content: string },
          cf,
        );

      case 'list_dir':
        return listDirTool(call.args as { path?: string });

      case 'run_terminal':
        return runTerminalTool(
          call.args as { command: string; cwd?: string },
          scf,
        );

      case 'save_memory':
        return saveMemoryTool(
          call.args as { key: string; value: string },
          mem,
        );

      case 'query_memory':
        return queryMemoryTool(call.args as { key?: string; query?: string }, mem);

      case 'search_web':
        return searchWebTool(call.args as { query: string; source?: string });

      case 'git_status':
        return gitStatusTool(call.args as { cwd?: string });

      case 'git_diff':
        return gitDiffTool(
          call.args as { staged?: boolean; path?: string; cwd?: string },
        );

      case 'git_log':
        return gitLogTool(call.args as { limit?: number; cwd?: string });

      default:
        return Promise.resolve(`Unknown tool: "${call.tool}". Known tools: ${KNOWN_TOOLS.join(', ')}`);
    }
  })();

  return withTimeout(
    execution,
    TOOL_TIMEOUT[call.tool] ?? 15_000,
    call.tool,
  );
}
