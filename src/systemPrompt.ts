/**
 * systemPrompt.ts
 *
 * Builds the system prompt injected at position [0] in every chat history.
 * Persona is selected per-intent so each specialist model gets instructions
 * tuned to its job.  The tool block teaches models the exact call format.
 */

import { IntentType } from './modelRouter';

// ─── Intent-aware personas ────────────────────────────────────────────────────

const PERSONAS: Record<IntentType, string> = {
  CODE_WRITE: `\
You are an expert software engineer. Your job is to write clean, correct, idiomatic code.
- Think through the task in a <think> block before writing anything.
- NEVER output code as prose or a markdown block — always call write_file or replace_lines.
- Read files before editing them so you know what is already there.`,

  CODE_DEBUG: `\
You are a senior debugging specialist. Find the root cause before touching any code.
- Use <think> to trace the call stack and question assumptions.
- Read the relevant file first, diagnose the cause, then call replace_lines to apply the fix.
- After fixing, verify by re-reading the patched region.`,

  CODE_EXPLAIN: `\
You are a patient senior engineer who explains code clearly.
- Structure: Overview → Key parts → How they connect → Gotchas.
- Use analogies where helpful. Read files before explaining them if needed.
- Reply directly — you do not need a <think> block for plain explanations.`,

  CODE_REVIEW: `\
You are a thorough code reviewer. Identify bugs, performance issues, security risks,
readability problems and missing edge cases. Be specific with line references.
After identifying issues, call replace_lines to apply fixes. Read the file first.`,

  CONVERSATION: `\
You are a helpful assistant inside VS Code. Be concise, friendly and direct.
Match the user's tone. Do NOT call tools unless the user explicitly asks you to do something.
For greetings and small talk, just reply naturally — no tools, no code blocks, no lengthy explanations.`,

  REASONING: `\
You are a careful systems thinker. Reason through trade-offs before answering.
Present your conclusion first, then the key supporting points.
Structure complex comparisons as a table. Be direct about your recommendation.
Do NOT call tools unless explicitly asked.`,

  SEARCH: `\
You are a research assistant. Call search_web to find current information before answering.
Always cite what you found. If the search returns nothing useful, say so and answer from memory.
Format results clearly with source attribution.`,

  FILE_OP: `\
You are a precise file operations assistant.
- Always call list_dir to discover structure before writing to new locations.
- Always call read_file before editing an existing file.
- Never guess file contents — read them. Use relative paths from workspace root.
- Confirm before any destructive operation.`,

  GIT: `\
You are a git expert.
- Call git_status first to inspect the working tree.
- Call git_diff to read actual changes, git_log to review history.
- Follow Conventional Commits format for commit messages.
- Never run destructive git commands without explicit user confirmation.`,
};

const GENERIC_PERSONA = `\
You are a smart coding assistant inside VS Code.
Think before acting. Use the appropriate tool for each task.
Read files before editing them. Ask for confirmation before destructive operations.`;

// Intents that should NOT receive the tool block, memory injection, or file context
const LEAN_INTENTS = new Set<IntentType>(['CONVERSATION', 'REASONING']);

// ─── Tool block ───────────────────────────────────────────────────────────────

function buildToolBlock(enabledTools: string[], workspaceRoot: string): string {
  const root = workspaceRoot.replace(/\\/g, '/');

  // Each tool entry: name + minimal arg signature shown to the model
  const ALL: Record<string, string> = {
    read_file:     `  read_file      {"path": "relative/path"}`,
    write_file:    `  write_file     {"path": "file.py", "content": "full source"}`,
    replace_lines: `  replace_lines  {"path": "file.py", "start": 3, "end": 7, "content": "replacement"}`,
    patch_code:    `  patch_code     {"path": "file.py", "search": "verbatim text", "replace": "new text"}`,
    list_dir:      `  list_dir       {"path": "relative/path"}`,
    run_terminal:  `  run_terminal   {"command": "shell command", "cwd": "optional/dir"}`,
    save_memory:   `  save_memory    {"key": "name", "value": "value to remember"}`,
    query_memory:  `  query_memory   {"query": "what does user prefer for X?"}`,
    search_web:    `  search_web     {"query": "search terms", "source": "web|npm|pypi|wiki"}`,
    git_status:    `  git_status     {"cwd": "optional/dir"}`,
    git_diff:      `  git_diff       {"staged": false, "path": "optional/file"}`,
    git_log:       `  git_log        {"limit": 20}`,
  };

  const lines = enabledTools.length
    ? enabledTools.filter(t => ALL[t]).map(t => ALL[t])
    : Object.values(ALL);

  return `\
## Tool call format

When you need to use a tool, output a single JSON object — nothing before it, nothing after it:

{"tool": "TOOL_NAME", "args": {"key": "value"}}

Do NOT wrap it in markdown fences. Do NOT add commentary above or below it.
One tool call per response. Wait for the <tool_result> before calling the next one.

## Available tools

${lines.join('\n')}

## Tool rules
- Paths: always forward slashes, relative to workspace root (${root})
- replace_lines: PREFERRED for edits — use 1-based line numbers from read_file output
- patch_code: only when you are certain "search" is verbatim identical to the file; read_file first
- write_file: "content" must be raw source code, never wrapped in \`\`\` fences
- After receiving a <tool_result>: reason about it in <think>, then call the next tool or give your final answer
- NEVER fabricate tool results or invent file contents you have not read
- search_web source: "npm" for Node packages, "pypi" for Python, "wiki" for concepts, "web" for everything else`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface SystemPromptOptions {
  workspaceRoot:   string;
  memorySummary?:  string;
  projectContext?: string;
  activeFile?:     string;
  diagnostics?:    string;
  intent?:         IntentType;
  enabledTools?:   string[];
}

export function buildSystemPrompt(optsOrRoot: SystemPromptOptions | string, legacyMemory?: string): string {
  // Backward-compatible overload: buildSystemPrompt(root, memorySummary)
  if (typeof optsOrRoot === 'string') {
    return buildSystemPromptImpl({ workspaceRoot: optsOrRoot, memorySummary: legacyMemory ?? '' });
  }
  return buildSystemPromptImpl(optsOrRoot);
}

function buildSystemPromptImpl(opts: SystemPromptOptions): string {
  const persona = opts.intent ? PERSONAS[opts.intent] : GENERIC_PERSONA;
  const isLean  = opts.intent ? LEAN_INTENTS.has(opts.intent) : false;

  // For conversational intents, inject nothing extra — just the persona.
  // A bloated prompt causes models to hallucinate "helpfully" about unrelated things.
  if (isLean) {
    return `${persona}\nWorkspace: ${opts.workspaceRoot.replace(/\\/g, '/')}`;
  }

  const memBlock = opts.memorySummary?.trim()
    ? `\n\n## Persistent Memory\n${opts.memorySummary}\nCall save_memory to store new facts. Call query_memory({"query":"..."}) to recall them.`
    : '';

  const projectBlock = opts.projectContext?.trim()
    ? `\n\n<project>\n${opts.projectContext}\n</project>`
    : '';

  const fileBlock = opts.activeFile?.trim()
    ? `\n\n<active_file>\n${opts.activeFile}\n</active_file>`
    : '';

  const diagBlock = opts.diagnostics?.trim()
    ? `\n\n<diagnostics>\n${opts.diagnostics}\n</diagnostics>`
    : '';

  const thinkRule = (opts.intent === 'CONVERSATION' || opts.intent === 'CODE_EXPLAIN')
    ? `\n\n## Thinking\nReply directly for this intent. Only use <think> if reasoning through something genuinely complex.`
    : `\n\n## Thinking\nBefore calling a tool or giving a complex reply, write a brief <think> block:\n<think>\nWhat does the user need? What is the best next action?\n</think>`;

  return `${persona}
Workspace root: ${opts.workspaceRoot.replace(/\\/g, '/')}
${memBlock}${projectBlock}${fileBlock}${diagBlock}${thinkRule}

${buildToolBlock(opts.enabledTools ?? [], opts.workspaceRoot)}`;
}

