# Desk Assistant — Super Plan v2.0
# Full Audit + Marco-o1 Intelligent Model Router

> Fully local · No API keys · Ollama-powered · VS Code native  
> Marco-o1 as the reasoning backbone for intent classification and model routing

---

## PART 1 — FULL IMPLEMENTATION AUDIT

Cross-referencing `plan.md` (v0.0.5 implementation status) against `complete-plan.md` (extended roadmap).

### Legend
- ✅ Fully implemented
- ⚠️ Partially implemented / config exists but not wired
- ❌ Not implemented at all

---

### Phase 1 — Copilot-Style Sidebar UI

| Item | Status | Gap |
|------|--------|-----|
| `WebviewViewProvider` replacing floating panel | ✅ | — |
| `package.json` viewsContainers + views | ✅ | — |
| SVG activity bar icon | ✅ | — |
| Sticky header: model selector + New Chat | ✅ | — |
| Scrollable message list + auto-scroll | ✅ | — |
| Auto-grow textarea + Send + Stop buttons | ✅ | — |
| Slash commands (all 8) | ✅ | — |
| `@filename` autocomplete dropdown + keyboard nav | ✅ | — |
| Copy button on code blocks | ✅ | — |
| `highlight.min.js` bundled syntax highlighting | ❌ | Not bundled. Code blocks have zero syntax colors. |
| VS Code design tokens throughout | ✅ | — |
| Collapsible think bubble (dashed border) | ✅ | — |
| Markdown rendering | ✅ | — |
| Char count display for long messages | ✅ | — |

**Phase 1: 93% complete. Only `highlight.min.js` missing.**

---

### Phase 2 — Persistent Memory

| Item | Status | Gap |
|------|--------|-----|
| `facts.json` key-value persistence | ✅ | — |
| Session creation + auto-titling (60-char) | ✅ | — |
| Session saving / loading / listing / deletion | ✅ | — |
| Max 200 messages per session with pruning | ✅ | — |
| Orphaned session pruning | ✅ | — |
| History rebuilt from session on load | ✅ | — |
| `save_memory` + `query_memory` tools | ✅ | — |
| `/memory` slash command | ✅ | — |
| `<memory>` block injected in system prompt | ✅ | — |
| `deskAssistant.maxHistoryTurns` respected at runtime | ⚠️ | Config key in `package.json` exists but `chat()` does NOT trim `this.history` to that limit. One-liner fix. |
| Memory categories + expiry (upgrade) | ❌ | Planned in complete-plan Phase 10.3. Not started. |
| `/forget <key>` slash command | ❌ | Not implemented. |

**Phase 2: 85% complete.**

---

### Phase 3 — Internet Search

| Item | Status | Gap |
|------|--------|-----|
| DuckDuckGo search | ✅ | — |
| npm registry search | ✅ | — |
| PyPI search | ✅ | — |
| Wikipedia summary | ✅ | — |
| `r.ok` guard on all endpoints | ✅ | — |
| Online detection + graceful offline fallback | ✅ | — |
| `search_web` tool in dispatch | ✅ | — |
| Offline status bar 🟢/🔴 indicator | ❌ | Planned but never implemented. |

**Phase 3: 87% complete.**

---

### Phase 4 — Multi-File @mention

| Item | Status | Gap |
|------|--------|-----|
| `@filename` autocomplete in textarea | ✅ | — |
| File content injected on mention | ✅ | — |
| Active editor injected as `<active_file>` | ✅ | — |
| `deskAssistant.injectActiveFile` config | ✅ | — |
| Dedicated `workspaceIndex.ts` module | ❌ | Logic is inline in `chatPanel.ts → handleGetFiles()`. No module. |
| `.deskignore` support | ❌ | Not implemented. |
| Index live-update on file create/delete | ❌ | Fresh `findFiles()` every call. No listeners. Slow on large workspaces. |
| Symbol index (function/class names per file) | ❌ | Planned in complete-plan Phase 8.2. Not started. |
| Related file detection (import graph, test files) | ❌ | Planned in complete-plan Phase 8.4. Not started. |

**Phase 4: 44% complete. Core UX works but the entire indexer layer is missing.**

---

### Phase 5 — Session Persistence & History

| Item | Status | Gap |
|------|--------|-----|
| Session persistence across restarts | ✅ | — |
| New Chat creates a new session | ✅ | — |
| Session list in sidebar header | ✅ | — |
| Click to restore past session | ✅ | — |
| `deskAssistant.maxHistoryTurns` config | ⚠️ | Same gap as Phase 2 — config exists, not wired at runtime. |
| Conversation branching (fork from message) | ❌ | Planned in complete-plan Phase 9.4. Not started. |

**Phase 5: 80% complete.**

---

### Phase 6 — Inline Ghost-Text Completions

| Item | Status | Gap |
|------|--------|-----|
| `src/completionProvider.ts` file | ❌ | Not created. |
| `InlineCompletionItemProvider` registered | ❌ | Not registered in `extension.ts`. |
| Debounced trigger (600ms) | ❌ | Not implemented. |
| FIM prompt format (`<PRE><SUF><MID>`) | ❌ | Not implemented. |
| Model capability detection (FIM vs plain) | ❌ | Not implemented. |
| `/api/generate` call with `num_predict: 80` | ❌ | Not implemented. |
| Tab to accept / Escape to dismiss | ❌ | Not implemented. |
| Completion caching (same cursor position) | ❌ | Not implemented. |
| Cancel in-flight on new keystroke | ❌ | Not implemented. |
| `deskAssistant.enableInlineCompletions` | ⚠️ | Config key exists in `package.json`. Provider not registered. |
| `deskAssistant.completionModel` | ⚠️ | Config key exists. Unused. |
| `deskAssistant.completionDebounceMs` | ❌ | Not in `package.json` yet. |
| `deskAssistant.completionMaxLines` | ❌ | Not in `package.json` yet. |

**Phase 6: 0% functional. Config stubs only.**

---

### Phase 7 — Diagnostics & Code Actions

| Item | Status | Gap |
|------|--------|-----|
| `src/diagnosticsProvider.ts` file | ❌ | Not created. |
| `getDiagnostics()` injected into system prompt | ❌ | Not implemented. |
| `<diagnostics>` block in prompt | ❌ | Not implemented. |
| Code Action provider registered | ❌ | Not registered. |
| "Fix with Desk Assistant" on red squiggles | ❌ | Not implemented. |
| "Explain this error" secondary action | ❌ | Not implemented. |
| Auto-verify after fix (re-run diagnostics 1.5s later) | ❌ | Not implemented. |

**Phase 7: 0% complete.**

---

### Phases 8–14 — Extended Roadmap (complete-plan.md)

All items from the extended plan are **0% implemented** since they were added in the extended roadmap and no work has started on any of them:

| Phase | Feature | Status |
|-------|---------|--------|
| 8.1 | `workspaceIndex.ts` dedicated module + `.deskignore` | ✅ v0.0.8 |
| 8.2 | Symbol index per file | ✅ v0.0.8 |
| 8.3 | Smart context selection (surgical injection) | ✅ v0.0.8 |
| 8.4 | Related file detection (import graph) | ✅ v0.0.8 |
| 9.1 | Message editing + resend | ✅ v0.0.8 |
| 9.2 | Prompt templates toolbar (Explain/Test/Refactor/Debug/Docs/Review) | ✅ v0.0.8 |
| 9.3 | CodeLens-style selection mini-toolbar | ❌ |
| 9.4 | Conversation branching | ❌ |
| 9.5 | Response actions (regenerate, rate, pin) | ✅ v0.0.8 |
| 10.1 | Context compression at 80% `num_ctx` | ✅ v0.0.9 |
| 10.2 | Token usage bar in chat footer | ✅ v0.0.6 |
| 10.3 | Semantic memory (categories + expiry) | ✅ v0.0.9 |
| 10.4 | Project memory (auto-detect `package.json` etc.) | ✅ v0.0.9 |
| 11.1 | Terminal command blocklist | ✅ v0.0.9 |
| 11.2 | Tool argument validation (path traversal prevention) | ✅ v0.0.9 |
| 11.3 | Tool retry logic with failure counter | ❌ |
| 11.4 | Audit log output channel | ✅ v0.0.9 |
| 12.1 | Git context injection | ❌ |
| 12.2 | `git_status` / `git_diff` / `git_log` tools | ❌ |
| 12.3 | Commit message generation | ❌ |
| 12.4 | PR / code review mode | ❌ |
| 13.1 | Per-task model routing | ✅ v0.0.7 |
| 13.2 | Model benchmarking command | ❌ |
| 13.3 | Streaming RAF batching optimization | ❌ |
| 13.4 | Request queuing | ❌ |
| 14.1 | Settings UI grouping + "Desk: Open Settings" command | ❌ |
| 14.2 | Onboarding flow for first-run | ❌ |
| 14.3 | Keyboard shortcuts (Ctrl+Shift+A/E/F) | ✅ v0.0.7 |
| 14.4 | Export chat as Markdown | ❌ |
| 14.5 | Centralized `strings.ts` | ❌ |

---

### Master Audit Summary

| Phase | Feature | Completion |
|-------|---------|-----------|
| 1 | Sidebar UI | 100% |
| 2 | Persistent Memory | 100% |
| 3 | Internet Search | 87% |
| 4 | Multi-file @mention | 100% |
| 5 | Session Persistence | 90% |
| 6 | Inline Completions | 100% |
| 7 | Diagnostics & Actions | 0% |
| 8–14 | Extended Roadmap | 0% |

### Ordered Fix List (Before Any New Phase)

| Priority | Item | Time |
|----------|------|------|
| 🔴 1 | `highlight.min.js` — bundle and wire to code blocks | 30 min |
| 🔴 2 | `maxHistoryTurns` — one-liner trim in `chat()` | 15 min |
| 🔴 3 | Offline status bar 🟢/🔴 indicator | 30 min |
| 🔴 4 | Diff preview on `write_file` | 30 min |
| 🔴 5 | Token usage display from `eval_count` | 45 min |
| 🟠 6 | `completionProvider.ts` — Phase 6 full | 2–3h |
| 🟠 7 | `diagnosticsProvider.ts` — Phase 7 full | 2h |
| 🟠 8 | `workspaceIndex.ts` — extract + live updates + `.deskignore` | 2h |
| 🟠 9 | `modelRouter.ts` — Marco-o1 router (see Part 2) | 3–4h |

---

---

## PART 2 — MARCO-O1 INTELLIGENT MODEL ROUTER

### Philosophy

**Marco-o1 is the brain. Every specialist model is a hand.**

Every user message is first received by Marco-o1 — a reasoning-first model. It thinks about what the user actually needs, classifies the intent, selects the best model for that task, rewrites the prompt to maximise that model's output quality, and returns a routing decision. The user sees only the final answer. The routing is invisible and instant.

```
User Message
     │
     ▼
┌──────────────────────────────┐
│         Marco-o1             │  ← Classifier + Prompt Engineer
│  <think> What does the user  │
│  actually need? Which model  │
│  handles this best? What     │
│  prompt maximises quality?   │
│  </think>                    │
│  → RouterDecision (JSON)     │
└──────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│              Specialist Model Pool                  │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │
│  │ CODE_WRITE │  │ CONVERSE   │  │ CODE_DEBUG    │ │
│  │ qwen2.5-  │  │ llama3.1: │  │ deepseek-     │ │
│  │ coder:7b  │  │ 8b         │  │ coder:6.7b    │ │
│  └────────────┘  └────────────┘  └───────────────┘ │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │
│  │ REASONING  │  │ SEARCH     │  │ INLINE        │ │
│  │ marco-o1  │  │ llama3.1+ │  │ qwen2.5-      │ │
│  │ (no reroute)│ │ search_web │  │ coder:1.5b    │ │
│  └────────────┘  └────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────┘
          │
          ▼
   Final Answer → User
```

---

### Intent Categories & Routing Table

| Intent | Trigger Signals | Routed Model | Temp | Tools Enabled |
|--------|----------------|--------------|------|---------------|
| `CODE_WRITE` | "write", "create", "implement", "build", file extension mentioned | `qwen2.5-coder:7b` | 0.15 | `read_file`, `write_file`, `patch_code` |
| `CODE_DEBUG` | "fix", "error", "bug", "crash", "not working", "why doesn't", stack trace present | `deepseek-coder:6.7b` | 0.1 | `read_file`, `patch_code`, diagnostics |
| `CODE_EXPLAIN` | "explain", "what does", "how does", "walk me through", "understand" | `qwen2.5-coder:7b` | 0.3 | `read_file` |
| `CODE_REVIEW` | "review", "improve", "optimise", "refactor", "best practice", "clean up" | `qwen2.5-coder:7b` | 0.2 | `read_file`, `patch_code` |
| `CONVERSATION` | greeting, opinion question, casual tone, "thanks", "what do you think" | `llama3.1:8b` | 0.7 | none |
| `REASONING` | "should I", "trade-off", "compare", "architect", "why is X better than Y", "decide" | `marco-o1` (no re-route) | 0.4 | none |
| `SEARCH` | "latest", "current", "find online", "look up", "what is X today", "documentation for" | `llama3.1:8b` | 0.3 | `search_web` |
| `FILE_OP` | "read file", "list files", "run command", "create folder", explicit tool names | `qwen2.5-coder:7b` | 0.1 | all tools |
| `GIT` | "commit", "diff", "branch", "merge", "PR", "git log", "what changed" | `qwen2.5-coder:7b` | 0.2 | `git_status`, `git_diff`, `git_log` |
| `INLINE_COMPLETE` | triggered by editor, not chat — bypasses router entirely | `qwen2.5-coder:1.5b` | 0.1 | none |

---

### New File: `src/modelRouter.ts`

```typescript
import { OllamaClient } from './ollamaClient';

export type IntentType =
  | 'CODE_WRITE'
  | 'CODE_DEBUG'
  | 'CODE_EXPLAIN'
  | 'CODE_REVIEW'
  | 'CONVERSATION'
  | 'REASONING'
  | 'SEARCH'
  | 'FILE_OP'
  | 'GIT';

export interface RouterDecision {
  intent: IntentType;
  model: string;           // Ollama model tag to use
  confidence: number;      // 0.0–1.0
  engineeredPrompt: string;// Rewritten prompt optimised for specialist model
  reasoning: string;       // Marco-o1's think text (shown in think bubble)
  useTools: string[];      // Tools to enable for this call
  temperature: number;
  numPredict: number;
}

// ─── MARCO-O1 SYSTEM PROMPT ────────────────────────────────────────────────
const ROUTER_SYSTEM = `You are an expert AI orchestrator for a VS Code coding assistant.

Your job on EVERY user message:
1. Analyse the user's intent and conversation context carefully
2. Classify the intent into exactly ONE of these categories:
   CODE_WRITE, CODE_DEBUG, CODE_EXPLAIN, CODE_REVIEW,
   CONVERSATION, REASONING, SEARCH, FILE_OP, GIT
3. Select the best specialist model from the available pool
4. Rewrite the user's prompt to maximise quality from that specialist model
5. Return ONLY a valid JSON object — no markdown, no preamble

Available models (from Ollama):
- qwen2.5-coder:7b     → best for CODE_WRITE, CODE_EXPLAIN, CODE_REVIEW, FILE_OP, GIT
- deepseek-coder:6.7b  → best for CODE_DEBUG (root cause analysis)
- llama3.1:8b          → best for CONVERSATION, SEARCH
- marco-o1             → best for REASONING (use yourself, no re-route)
- qwen2.5-coder:1.5b   → INLINE_COMPLETE only (never route chat here)

Response format (JSON only, no backticks):
{
  "intent": "CODE_WRITE",
  "model": "qwen2.5-coder:7b",
  "confidence": 0.95,
  "engineeredPrompt": "<rewritten prompt here>",
  "reasoning": "<your think text — why you chose this model and intent>",
  "useTools": ["read_file", "write_file"],
  "temperature": 0.15,
  "numPredict": 2048
}

Rules:
- NEVER route to qwen2.5-coder:1.5b for chat (inline completions only)
- If intent is REASONING, set model to "marco-o1" (yourself) — no re-route
- If confidence < 0.6, default to CONVERSATION with llama3.1:8b
- engineeredPrompt must be complete and self-contained — the specialist model
  will NOT see the original user message, only engineeredPrompt
- Include <active_file> and <diagnostics> context in engineeredPrompt if relevant
- Keep engineeredPrompt concise — do not bloat it`;

// ─── ROUTER CLASS ───────────────────────────────────────────────────────────
export class ModelRouter {
  private client: OllamaClient;
  private routerModel = 'marco-o1';

  // Fallback routing table used when marco-o1 is unavailable
  private static FALLBACK: Record<string, Partial<RouterDecision>> = {
    CODE_WRITE:   { model: 'qwen2.5-coder:7b',    temperature: 0.15, numPredict: 2048 },
    CODE_DEBUG:   { model: 'deepseek-coder:6.7b', temperature: 0.1,  numPredict: 2048 },
    CODE_EXPLAIN: { model: 'qwen2.5-coder:7b',    temperature: 0.3,  numPredict: 1024 },
    CODE_REVIEW:  { model: 'qwen2.5-coder:7b',    temperature: 0.2,  numPredict: 1024 },
    CONVERSATION: { model: 'llama3.1:8b',          temperature: 0.7,  numPredict: 512  },
    REASONING:    { model: 'marco-o1',             temperature: 0.4,  numPredict: 2048 },
    SEARCH:       { model: 'llama3.1:8b',          temperature: 0.3,  numPredict: 1024 },
    FILE_OP:      { model: 'qwen2.5-coder:7b',    temperature: 0.1,  numPredict: 2048 },
    GIT:          { model: 'qwen2.5-coder:7b',    temperature: 0.2,  numPredict: 1024 },
  };

  constructor(client: OllamaClient) {
    this.client = client;
  }

  async route(
    userMessage: string,
    context: {
      activeFile?: string;
      diagnostics?: string;
      history?: Array<{ role: string; content: string }>;
      availableModels: string[];
    }
  ): Promise<RouterDecision> {
    // Build the classification prompt
    const classifyPrompt = `
User message: "${userMessage}"

Available models on this machine: ${context.availableModels.join(', ')}

${context.activeFile ? `Active file context:\n${context.activeFile.slice(0, 800)}` : ''}
${context.diagnostics ? `Current diagnostics:\n${context.diagnostics}` : ''}

Classify this message and return the routing JSON.`.trim();

    try {
      const raw = await this.client.generate({
        model: this.routerModel,
        prompt: classifyPrompt,
        system: ROUTER_SYSTEM,
        stream: false,
        options: { temperature: 0.1, num_predict: 512 }
      });

      // Strip any accidental markdown fences
      const cleaned = raw.response
        .replace(/```json|```/g, '')
        .trim();

      const decision: RouterDecision = JSON.parse(cleaned);

      // Safety: if routed model is not installed, fall back to best available
      if (!context.availableModels.includes(decision.model)) {
        decision.model = this.bestAvailable(decision.intent, context.availableModels);
      }

      return decision;

    } catch {
      // Marco-o1 unavailable or parse failed — use keyword fallback
      return this.keywordFallback(userMessage, context.availableModels);
    }
  }

  // ─── KEYWORD FALLBACK ─────────────────────────────────────────────────────
  // Used when marco-o1 is not installed or returns unparseable output.
  private keywordFallback(msg: string, available: string[]): RouterDecision {
    const m = msg.toLowerCase();

    let intent: IntentType = 'CONVERSATION';
    if (/\b(write|create|implement|build|generate|make a)\b/.test(m)) intent = 'CODE_WRITE';
    else if (/\b(fix|bug|error|crash|exception|not working|broken|fails)\b/.test(m)) intent = 'CODE_DEBUG';
    else if (/\b(explain|what does|how does|walk me through|understand)\b/.test(m)) intent = 'CODE_EXPLAIN';
    else if (/\b(review|refactor|improve|optimise|optimize|clean up)\b/.test(m)) intent = 'CODE_REVIEW';
    else if (/\b(commit|diff|branch|merge|pull request|git log|git status)\b/.test(m)) intent = 'GIT';
    else if (/\b(find|search|latest|current|look up|documentation for)\b/.test(m)) intent = 'SEARCH';
    else if (/\b(read file|write file|list|run command|run terminal)\b/.test(m)) intent = 'FILE_OP';
    else if (/\b(should i|trade.?off|compare|which is better|architect|decide)\b/.test(m)) intent = 'REASONING';

    const fallback = ModelRouter.FALLBACK[intent];
    const model = this.bestAvailable(intent, available);

    return {
      intent,
      model,
      confidence: 0.6,
      engineeredPrompt: msg,  // pass through unchanged on fallback
      reasoning: `Marco-o1 unavailable. Keyword-matched intent: ${intent}`,
      useTools: this.defaultTools(intent),
      temperature: (fallback.temperature as number) ?? 0.3,
      numPredict: (fallback.numPredict as number) ?? 1024,
    };
  }

  private bestAvailable(intent: IntentType, available: string[]): string {
    const preference = ModelRouter.FALLBACK[intent]?.model as string;
    if (available.includes(preference)) return preference;
    // Priority fallback chain
    const chain = [
      'qwen2.5-coder:7b', 'deepseek-coder:6.7b',
      'llama3.1:8b', 'llama3.2:3b', 'qwen2.5-coder:1.5b'
    ];
    return chain.find(m => available.includes(m)) ?? available[0];
  }

  private defaultTools(intent: IntentType): string[] {
    const map: Record<IntentType, string[]> = {
      CODE_WRITE:   ['read_file', 'write_file', 'patch_code', 'list_dir'],
      CODE_DEBUG:   ['read_file', 'patch_code'],
      CODE_EXPLAIN: ['read_file'],
      CODE_REVIEW:  ['read_file', 'patch_code'],
      CONVERSATION: [],
      REASONING:    [],
      SEARCH:       ['search_web'],
      FILE_OP:      ['read_file', 'write_file', 'patch_code', 'list_dir', 'run_terminal'],
      GIT:          ['run_terminal'],
    };
    return map[intent] ?? [];
  }
}
```

---

### Integration into `src/chatPanel.ts`

Replace the existing `chat()` call with a two-step flow:

```typescript
// In chatPanel.ts — updated chat() method

async chat(userMessage: string): Promise<void> {
  // Step 1 — Route via Marco-o1
  const decision = await this.router.route(userMessage, {
    activeFile: this.getActiveFileContext(),
    diagnostics: this.getDiagnosticsContext(),
    history: this.history,
    availableModels: await this.ollama.listModels(),
  });

  // Show routing decision in think bubble (collapsible)
  this.postThink(
    `🧭 Intent: ${decision.intent} (${Math.round(decision.confidence * 100)}% confident)\n` +
    `🤖 Model: ${decision.model}\n` +
    `💭 ${decision.reasoning}`
  );

  // Step 2 — Send engineered prompt to specialist model
  await this.streamChat({
    model: decision.model,
    prompt: decision.engineeredPrompt,
    tools: decision.useTools,
    temperature: decision.temperature,
    numPredict: decision.numPredict,
  });
}
```

---

### Updated `src/systemPrompt.ts`

The system prompt is now **model-aware** — different preambles per intent:

```typescript
export function buildSystemPrompt(
  intent: IntentType,
  memory: string,
  activeFile: string,
  diagnostics: string
): string {

  const personas: Record<IntentType, string> = {
    CODE_WRITE:
      `You are an expert software engineer. Write clean, correct, idiomatic code.
       Always use <think> to plan before writing. Use patch_code or write_file to apply changes.
       Never output raw code without applying it via a tool.`,

    CODE_DEBUG:
      `You are a senior debugging specialist. Find the root cause before proposing a fix.
       Use <think> to reason through the error carefully. Read relevant files first.
       Explain what caused the bug, then apply the fix via patch_code.`,

    CODE_EXPLAIN:
      `You are a patient senior engineer. Explain code clearly for the person's level.
       Use analogies where helpful. Structure your explanation: Overview → Key parts → How they connect.`,

    CODE_REVIEW:
      `You are a thorough code reviewer. Identify: bugs, performance issues, security risks,
       readability problems. Be specific with line references. Suggest improvements via patch_code.`,

    CONVERSATION:
      `You are a friendly, knowledgeable assistant. Be concise and natural.
       Match the user's tone. No need to use tools unless explicitly asked.`,

    REASONING:
      `You are a careful systems thinker. Use <think> to reason through trade-offs before answering.
       Present your conclusion clearly, with the key reasoning that led to it.`,

    SEARCH:
      `You are a research assistant. Use search_web to find current information before answering.
       Always cite what you found. If offline, say so clearly and answer from memory.`,

    FILE_OP:
      `You are a precise file operations assistant. Always confirm before destructive operations.
       Use list_dir before write_file. Use read_file before patch_code. Never guess file contents.`,

    GIT:
      `You are a git expert. Use run_terminal to read git state before answering.
       Explain git concepts clearly. For commit messages follow Conventional Commits format.`,
  };

  return `${personas[intent]}

<memory>
${memory || 'No saved facts yet.'}
</memory>

${activeFile ? `<active_file>\n${activeFile}\n</active_file>` : ''}
${diagnostics ? `<diagnostics>\n${diagnostics}\n</diagnostics>` : ''}

Rules that always apply:
- Think in <think> blocks before every response
- Ask for confirmation before any destructive file or terminal operation
- Never invent file contents — read them first
- If you are not sure, say so`;
}
```

---

### `src/ollamaClient.ts` — Add `generate()` method

The router needs a non-streaming generate call:

```typescript
async generate(params: {
  model: string;
  prompt: string;
  system?: string;
  stream: false;
  options?: Record<string, unknown>;
}): Promise<{ response: string }> {
  const res = await fetch(`${this.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      system: params.system,
      stream: false,
      options: params.options ?? {},
    }),
  });
  if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
  return res.json();
}
```

---

### UI Changes for Model Routing

**In `webview/main.js`:**

- Think bubble now shows the routing decision automatically (intent, model, confidence)
- Status bar shows the **active specialist model** for the current message (updates per-message)
- Model selector in header is now labelled **"Chat Model"** (clarifies it sets the default, Marco-o1 may override)
- Add a `⚙️ Router` toggle in settings to disable Marco-o1 routing and use a single model (for users on low RAM)

**Routing indicator in chat:**
```
╔═══════════════════════════════════╗
║ 🧭 Routed to: deepseek-coder:6.7b ║
║    Intent: CODE_DEBUG · 94%       ║
╚═══════════════════════════════════╝
```
This appears as a collapsible info bubble above the assistant response.

---

### Config Keys to Add to `package.json`

```json
"deskAssistant.routerModel": {
  "type": "string",
  "default": "marco-o1",
  "description": "Model used to classify intent and route to specialist models. Must be installed in Ollama."
},
"deskAssistant.enableRouter": {
  "type": "boolean",
  "default": true,
  "description": "Enable Marco-o1 intelligent model routing. Disable to always use chatModel."
},
"deskAssistant.showRoutingInfo": {
  "type": "boolean",
  "default": true,
  "description": "Show routing decision (intent + model) as a collapsible bubble in chat."
},
"deskAssistant.routerFallbackModel": {
  "type": "string",
  "default": "qwen2.5-coder:7b",
  "description": "Model to use when Marco-o1 is unavailable."
},
"deskAssistant.chatModel": {
  "type": "string",
  "default": "qwen2.5-coder:7b",
  "description": "Default chat model (used when router is disabled)."
},
"deskAssistant.completionModel": {
  "type": "string",
  "default": "qwen2.5-coder:1.5b",
  "description": "Model for inline ghost-text completions. Should be fast and small."
},
"deskAssistant.summaryModel": {
  "type": "string",
  "default": "llama3.2:3b",
  "description": "Model for context compression summaries."
}
```

---

---

## PART 3 — COMPLETE UPDATED EXECUTION ORDER

Combining the audit gaps + new Marco-o1 router into one definitive build order:

| # | Item | File(s) | Effort | Priority | Status |
|---|------|---------|--------|----------|--------|
| 1 | `highlight.min.js` bundle + wire | `webview/highlight.min.js`, `main.js` | 30 min | 🔴 | ✅ v0.0.6 |
| 2 | `maxHistoryTurns` runtime trim | `chatPanel.ts` | 15 min | 🔴 | ✅ v0.0.6 |
| 3 | Offline status bar indicator | `extension.ts` | 30 min | 🔴 | ✅ v0.0.6 |
| 4 | Diff preview on `write_file` | `tools/writeFile.ts`, `confirmationProvider.ts` | 30 min | 🔴 | ✅ v0.0.6 |
| 5 | Token usage display (`eval_count`) | `webview/main.js`, `chatPanel.ts` | 45 min | 🔴 | ✅ v0.0.6 |
| 6 | `completionProvider.ts` (Phase 6 full) | `src/completionProvider.ts`, `extension.ts` | 2–3h | 🔴 | ✅ v0.0.6 |
| 7 | `diagnosticsProvider.ts` (Phase 7 full) | `src/diagnosticsProvider.ts`, `extension.ts` | 2h | 🔴 | ✅ v0.0.7 |
| 8 | `ollamaClient.ts` — add `generate()` method | `src/ollamaClient.ts` | 30 min | 🔴 | ✅ v0.0.7 |
| 9 | `modelRouter.ts` — Marco-o1 router | `src/modelRouter.ts` | 2h | 🔴 | ✅ v0.0.7 |
| 10 | Wire router into `chatPanel.ts` | `src/chatPanel.ts` | 1h | 🔴 | ✅ v0.0.7 |
| 11 | Model-aware `systemPrompt.ts` | `src/systemPrompt.ts` | 1h | 🔴 | ✅ v0.0.7 |
| 12 | Router UI (think bubble + status bar per-message) | `webview/main.js`, `styles.css` | 1h | 🔴 | ✅ v0.0.7 |
| 13 | `workspaceIndex.ts` module + `.deskignore` | `src/workspaceIndex.ts` | 2h | 🟠 | ✅ v0.0.8 |
| 14 | Symbol index | `src/workspaceIndex.ts` | 1h | 🟠 | ✅ v0.0.8 |
| 15 | Smart context selection (`contextBuilder.ts`) | `src/contextBuilder.ts` | 2h | 🟠 | ✅ v0.0.8 |
| 16 | Message editing + resend | `webview/main.js`, `chatPanel.ts` | 2h | 🟠 | ✅ v0.0.8 |
| 17 | Prompt templates toolbar | `webview/main.js`, `styles.css` | 1h | 🟠 | ✅ v0.0.8 |
| 18 | Response actions (regenerate, rate, pin) | `webview/main.js` | 1h | 🟠 | ✅ v0.0.8 |
| 19 | Context compression at 80% `num_ctx` | `chatPanel.ts` | 2h | 🟠 | ✅ v0.0.9 |
| 20 | Semantic memory (categories + expiry + `/forget`) | `memoryManager.ts`, tools | 2h | 🟠 | ✅ v0.0.9 |
| 21 | Project memory (auto-detect project type) | `memoryManager.ts`, `systemPrompt.ts` | 1h | 🟠 | ✅ v0.0.9 |
| 22 | Terminal command blocklist | `tools/runTerminal.ts`, `package.json` | 1h | 🟠 | ✅ v0.0.9 |
| 23 | Tool argument validation (path traversal) | all tool files | 1h | 🟠 | ✅ v0.0.9 |
| 24 | Audit log output channel | `extension.ts`, `chatPanel.ts` | 1h | 🟠 | ✅ v0.0.9 |
| 25 | Git tools (`git_status`, `git_diff`, `git_log`) | `src/tools/gitStatus.ts`, `gitDiff.ts`, `gitLog.ts` | 2h | 🟡 | ✅ v0.1.0 |
| 26 | Commit message generation | `webview/main.js`, `chatPanel.ts` | 1h | 🟡 | ✅ v0.1.0 |
| 27 | Conversation branching (fork session) | `memoryManager.ts`, `chatPanel.ts`, `main.js` | 2h | 🟡 | ✅ v0.1.0 |
| 28 | Streaming RAF batching | `webview/main.js` | 1h | 🟡 | ✅ v0.1.0 |
| 29 | Request queuing | `chatPanel.ts` | 1h | 🟡 | ✅ v0.1.0 |
| 30 | Model benchmarking command | `extension.ts`, `ollamaClient.ts` | 1h | 🟡 | ✅ v0.1.0 |
| 31 | Onboarding first-run flow | `webview/main.js` | 1h | 🟡 | ❌ |
| 32 | Keyboard shortcuts | `package.json`, `extension.ts` | 30 min | 🟡 | ✅ v0.0.7 |
| 33 | Export chat as Markdown | `webview/main.js`, `chatPanel.ts` | 30 min | 🟡 | ❌ |
| 34 | Settings grouping + "Desk: Open Settings" | `package.json`, `extension.ts` | 30 min | 🟡 | ❌ |
| 35 | Centralise UI strings → `strings.ts` | `webview/main.js`, new file | 1h | 🟢 | ❌ |

---

## PART 4 — UPDATED FILE STRUCTURE (v1.0 Target)

```
desk-assistant/
├── src/
│   ├── extension.ts              ✅ audit log init, keyboard shortcuts, onboarding check, benchmarkModels
│   ├── chatPanel.ts              ✅ router, compressHistory, /forget, projectContext, request queue, forkSession, generateCommit
│   ├── systemPrompt.ts           ✅ intent-aware personas + projectContext block + git tools
│   ├── ollamaClient.ts           ✅ generate(), streamChat, RAF batching
│   ├── memoryManager.ts          ✅ categories, expiry, forgetFact, detectProjectContext, forkSession
│   ├── modelRouter.ts            ✅ Marco-o1 router (Part 2) + git tools in GIT intent
│   ├── workspaceIndex.ts         ✅ file index, symbol index, .deskignore, watchers
│   ├── contextBuilder.ts         ✅ smart context selection, import graph
│   ├── auditLog.ts               ✅ NEW v0.0.9 — output channel audit log
│   ├── gitProvider.ts            ✅ v0.1.0 — native git tools (gitStatus, gitDiff, gitLog)
│   ├── webSearch.ts              ✅
│   ├── confirmationProvider.ts   ✅
│   ├── completionProvider.ts     ✅ inline ghost-text (Phase 6)
│   ├── diagnosticsProvider.ts    ✅ error injection + code actions (Phase 7)
│   └── tools/
│       ├── pathUtils.ts          ✅ NEW v0.0.9 — validatePath(), tryValidatePath()
│       ├── readFile.ts           ✅ + path traversal guard
│       ├── writeFile.ts          ✅ + path traversal guard + audit log
│       ├── patchCode.ts          ✅ + path traversal guard + audit log
│       ├── listDir.ts            ✅ + path traversal guard
│       ├── runTerminal.ts        ✅ + blocklist check + audit log
│       ├── saveMemory.ts         ✅ + category/ttlDays params
│       ├── queryMemory.ts        ✅
│       ├── searchWeb.ts          ✅
│       ├── gitStatus.ts          ✅ v0.1.0 — git status --porcelain -b
│       ├── gitDiff.ts            ✅ v0.1.0 — git diff [--staged] [path]
│       └── gitLog.ts             ✅ v0.1.0 — git log --oneline --graph -n N
├── webview/
│   ├── main.js                   ✅ router UI, templates, edit+fork buttons, token bar, RAF batching, /commit, /forget
│   ├── styles.css                ✅ routing bubble, token bar, msg actions, templates bar
│   ├── icon.svg                  ✅
│   └── highlight.min.js          ✅ bundled
├── .deskignore                   ✅ default ignore patterns
├── esbuild.js                    ✅
├── package.json                  ✅ v0.1.0 — benchmarkModels command added
├── tsconfig.json                 ✅
├── .vscodeignore                 ✅
└── super-plan.md                 ✅ this file
```

---

## PART 5 — RECOMMENDED MODEL STACK

| Role | Model | RAM | Notes |
|------|-------|-----|-------|
| **Router / Reasoner** | `marco-o1` | ~5GB VRAM | Brain of the system. Must be installed. |
| **Code writer / reviewer** | `qwen2.5-coder:7b` | ~5GB VRAM | Best overall code quality |
| **Debugger** | `deepseek-coder:6.7b` | ~4GB VRAM | Exceptional root-cause analysis |
| **Conversationalist** | `llama3.1:8b` | ~5GB VRAM | Best natural language |
| **Summariser** | `llama3.2:3b` | ~2GB VRAM | Context compression, fast |
| **Inline completions** | `qwen2.5-coder:1.5b` | ~1GB VRAM | Always-on, sub-200ms |
| **Alt completions** | `starcoder2:3b` | ~2GB VRAM | Strong FIM, multilang |

**Minimum viable setup (4GB VRAM):**
- `marco-o1` + `qwen2.5-coder:1.5b` only — router + completions. Chat handled by Marco-o1 directly.

**Full setup (16GB VRAM):**
- All models loaded simultaneously. Zero swap, zero latency.

---

## PART 6 — NON-FUNCTIONAL REQUIREMENTS

| Requirement | Target | Status |
|-------------|--------|--------|
| All processing local | 100% | ✅ Ollama only |
| No API keys | ✅ | ✅ All endpoints keyless |
| Works offline | ✅ | ✅ Graceful degradation |
| Model-agnostic | ✅ | ✅ Any Ollama model |
| Router fallback when marco-o1 absent | ✅ | ❌ Not yet — implement keyword fallback |
| Extension size | < 3MB packaged | ✅ (hljs adds ~50KB) |
| Startup time | < 300ms | ✅ |
| Router latency (marco-o1 classify) | < 1.5s | ❌ Not yet measured |
| Inline completion latency | < 400ms p95 | ❌ Not yet implemented |
| Tool call timeout | < 15s configurable | ✅ |
| Context overflow protection | 80% `num_ctx` | ✅ v0.0.9 |
| Terminal safety blocklist | ✅ | ✅ v0.0.9 |
| Privacy | No telemetry | ✅ |

---

## BUILD & RELEASE

```bash
# Compile
node esbuild.js

# Package
echo y | npx vsce package --no-yarn --allow-missing-repository

# Install
code --install-extension desk-assistant-X.X.X.vsix --force

# Reload
# Ctrl+Shift+P → Developer: Restart Extension Host
```

**Version targets:**
- `v0.0.6` — Immediate wins + highlight.min.js
- `v0.1.0` — Phase 6 (completions) + Phase 7 (diagnostics)
- `v0.2.0` — Marco-o1 router live
- `v0.3.0` — Context intelligence (Phase 8) + advanced UX (Phase 9)
- `v1.0.0` — All phases complete, full Copilot parity + intelligent routing

---

*The goal: a private, free, production-grade Copilot that thinks before it acts — and routes to the best model for every task.*