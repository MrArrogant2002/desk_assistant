/**
 * modelRouter.ts
 *
 * Responsible for one thing: deciding which model and intent best matches
 * a user message and returning a RouterDecision.
 *
 * Strategy:
 *   1. If marco-o1:latest is available and the router is enabled, ask it to
 *      classify the intent and choose a specialist model.
 *   2. If marco-o1 is unavailable or classification fails, fall back to fast
 *      keyword matching so the chat never stalls.
 *   3. After routing, enforce that code intents always land on the code model.
 *
 * Installed models (user's machine):
 *   marco-o1:latest      — router + reasoning + conversation
 *   CodeGemma:latest     — code writing, debugging, review, file ops
 *   mistral:7b           — explanations, git, research/search
 *   llama3.2:latest      — fallback / summarisation
 *   qwen2.5-coder:1.5b  — inline completions ONLY (last-resort fallback)
 */

import * as vscode from 'vscode';
import { generateOnce } from './ollamaClient';

// ─── Public types ─────────────────────────────────────────────────────────────

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
  /** Classified intent category */
  intent:           IntentType;
  /** Ollama model tag to use for the actual response */
  model:            string;
  /** 0.0–1.0 confidence from the router model */
  confidence:       number;
  /** Rewritten prompt optimised for the specialist model */
  engineeredPrompt: string;
  /** One-line explanation of the routing decision (shown in UI) */
  reasoning:        string;
  /** Tool names to enable for this request */
  useTools:         string[];
  /** Sampling temperature for the specialist model */
  temperature:      number;
  /** Max tokens for the specialist model */
  numPredict:       number;
}

// ─── Intent ↔ model preference table ─────────────────────────────────────────

interface IntentPrefs {
  preferredModel: string;
  temperature:    number;
  numPredict:     number;
  tools:          string[];
}

/**
 * Maps each intent to the best local model for that task.
 * Must only reference models actually installed on the user's machine.
 */
const INTENT_PREFS: Record<IntentType, IntentPrefs> = {
  CODE_WRITE: {
    preferredModel: 'CodeGemma:latest',
    temperature: 0.15, numPredict: 2048,
    tools: ['read_file', 'write_file', 'replace_lines', 'list_dir'],
  },
  CODE_DEBUG: {
    preferredModel: 'CodeGemma:latest',
    temperature: 0.10, numPredict: 2048,
    tools: ['read_file', 'replace_lines'],
  },
  CODE_EXPLAIN: {
    preferredModel: 'mistral:7b',
    temperature: 0.30, numPredict: 1024,
    tools: ['read_file'],
  },
  CODE_REVIEW: {
    preferredModel: 'CodeGemma:latest',
    temperature: 0.20, numPredict: 1024,
    tools: ['read_file', 'replace_lines'],
  },
  CONVERSATION: {
    preferredModel: 'marco-o1:latest',
    temperature: 0.70, numPredict: 512,
    tools: [],
  },
  REASONING: {
    preferredModel: 'marco-o1:latest',
    temperature: 0.40, numPredict: 2048,
    tools: [],
  },
  SEARCH: {
    preferredModel: 'mistral:7b',
    temperature: 0.30, numPredict: 1024,
    tools: ['search_web'],
  },
  FILE_OP: {
    preferredModel: 'CodeGemma:latest',
    temperature: 0.10, numPredict: 2048,
    tools: ['read_file', 'write_file', 'replace_lines', 'list_dir', 'run_terminal'],
  },
  GIT: {
    preferredModel: 'mistral:7b',
    temperature: 0.20, numPredict: 1024,
    tools: ['git_status', 'git_diff', 'git_log'],
  },
};

/**
 * Intents that must always use the code specialist model, regardless of what
 * the router model chooses. Marco-o1 can over-confidently route these to itself.
 */
const CODE_INTENTS: Set<IntentType> = new Set([
  'CODE_WRITE', 'CODE_DEBUG', 'CODE_REVIEW', 'FILE_OP',
]);

// ─── Router system prompt ─────────────────────────────────────────────────────

const ROUTER_SYSTEM = `\
You are a routing agent for a VS Code AI coding assistant.

Your only job: classify the user's message into one intent and select the best \
specialist model. Available models will be in the user's message — only pick from that list.

Intent definitions:
  CODE_WRITE   — write, create, implement, build, generate, scaffold code
  CODE_DEBUG   — fix, error, bug, crash, exception, not working, broken, traceback
  CODE_EXPLAIN — explain, understand, how does, what is, walk me through
  CODE_REVIEW  — review, refactor, optimise, clean up, improve, best practice
  CONVERSATION — greetings, opinion, casual chat, thanks
  REASONING    — trade-offs, compare, architect, should I, which is better, pros/cons
  SEARCH       — latest, look up, find online, npm, pypi, documentation for
  FILE_OP      — read file, list files, run command, terminal, mkdir, rename
  GIT          — commit, diff, branch, merge, pull request, git log, git status

Step 1 — Think inside <think>...</think>: What is the user trying to do?
Step 2 — After </think>, output ONLY this JSON (no markdown fences, no extra text):
{
  "intent": "CODE_WRITE",
  "model": "CodeGemma:latest",
  "confidence": 0.92,
  "engineeredPrompt": "self-contained rewritten prompt optimised for the specialist",
  "reasoning": "one sentence: why this intent and model",
  "useTools": ["read_file", "write_file", "replace_lines"],
  "temperature": 0.15,
  "numPredict": 2048
}

Hard rules:
- Only pick a model from the "Available models" list provided.
- Never pick qwen2.5-coder:1.5b for chat responses (inline completions only).
- engineeredPrompt must be fully self-contained — the specialist sees nothing else.`;

// ─── ModelRouter ──────────────────────────────────────────────────────────────

export class ModelRouter {
  /**
   * Route `userMessage` to the best model + intent.
   *
   * @param userMessage    The raw user input
   * @param context        Active file snippet, diagnostics, and the list of installed models
   * @param signal         Optional AbortSignal for cancellation
   * @returns              A RouterDecision with model, intent, tools, etc.
   */
  async route(
    userMessage: string,
    context: {
      activeFileSnippet?: string;
      diagnosticsSummary?: string;
      availableModels:     string[];
    },
    signal?: AbortSignal,
  ): Promise<RouterDecision> {
    const cfg         = vscode.workspace.getConfiguration('deskAssistant');
    const enabled     = cfg.get<boolean>('enableRouter', true);
    const routerModel = cfg.get<string>('routerModel', 'marco-o1:latest');

    // Skip LLM routing if disabled or router model not installed
    if (!enabled || !context.availableModels.includes(routerModel)) {
      return this.keywordFallback(userMessage, context.availableModels);
    }

    const classifyPrompt = this.buildClassifyPrompt(userMessage, context);

    try {
      const raw = await generateOnce({
        model:   routerModel,
        prompt:  classifyPrompt,
        system:  ROUTER_SYSTEM,
        options: { temperature: 0.05, num_predict: 512 },
        signal,
      });

      // Strip think/Thought blocks and any markdown code fences
      const stripped = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<Thought>[\s\S]*?<\/Thought>/gi, '')
        .replace(/```json|```/g, '')
        .trim();

      const jsonStart = stripped.indexOf('{');
      const jsonEnd   = stripped.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No JSON object in router response');
      }

      const decision = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1)) as RouterDecision;

      // Ensure the chosen model is actually installed
      if (!context.availableModels.includes(decision.model)) {
        decision.model = this.bestAvailable(decision.intent, context.availableModels);
      }

      // Enforce specialist model for code/tool intents — reasoning models
      // tend to claim all tasks for themselves.
      if (CODE_INTENTS.has(decision.intent)) {
        const specialist = INTENT_PREFS[decision.intent].preferredModel;
        if (context.availableModels.includes(specialist)) {
          decision.model = specialist;
        }
      }

      decision.confidence = Math.min(1, Math.max(0, decision.confidence ?? 0.6));
      return decision;

    } catch {
      // Router failed (parse error, timeout, model offline) — degrade gracefully
      return this.keywordFallback(userMessage, context.availableModels);
    }
  }

  // ─── Keyword fallback ───────────────────────────────────────────────────────

  /**
   * Fast regex-based intent classification used when the LLM router is
   * unavailable. Covers the most common request patterns.
   */
  private keywordFallback(msg: string, available: string[]): RouterDecision {
    const m = msg.toLowerCase();
    let intent: IntentType = 'CONVERSATION';

    if (/\b(write|create|implement|build|generate|scaffold|make a|add a|i need a)\b/.test(m))
      intent = 'CODE_WRITE';
    else if (/\b(fix|bug|error|crash|exception|not working|broken|fails|traceback|undefined is not)\b/.test(m))
      intent = 'CODE_DEBUG';
    else if (/\b(explain|what does|how does|walk me through|understand|what is|describe|how it works)\b/.test(m))
      intent = 'CODE_EXPLAIN';
    else if (/\b(review|refactor|improve|optimis[ez]|clean up|best practice|rewrite|restructure)\b/.test(m))
      intent = 'CODE_REVIEW';
    else if (/\b(commit|diff|branch|merge|pull request|\bpr\b|git log|git status|what changed|stash)\b/.test(m))
      intent = 'GIT';
    else if (/\b(find|search|latest|current|look up|documentation|npm |pypi|version of|when was)\b/.test(m))
      intent = 'SEARCH';
    else if (/\b(read file|list files|\bls\b|run command|run terminal|mkdir|rename|delete)\b/.test(m))
      intent = 'FILE_OP';
    else if (/\b(should i|trade.?off|compare|which is better|architect|decide|pros.?cons|\bvs\b)\b/.test(m))
      intent = 'REASONING';

    const prefs = INTENT_PREFS[intent];
    const model = this.bestAvailable(intent, available);

    return {
      intent,
      model,
      confidence:       0.5,
      engineeredPrompt: msg,
      reasoning:        `Keyword fallback (router model unavailable). Intent: ${intent}`,
      useTools:         prefs.tools,
      temperature:      prefs.temperature,
      numPredict:       prefs.numPredict,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Pick the best model for an intent from the actually-installed list.
   * Falls back through a priority chain so there is always a valid model.
   */
  private bestAvailable(intent: IntentType, available: string[]): string {
    const preferred = INTENT_PREFS[intent].preferredModel;
    if (available.includes(preferred)) { return preferred; }

    // Priority chain: best general-purpose → smallest usable
    const fallbackChain = [
      'CodeGemma:latest',
      'marco-o1:latest',
      'mistral:7b',
      'llama3.2:latest',
      'qwen2.5-coder:1.5b',
    ];
    return fallbackChain.find(m => available.includes(m)) ?? available[0] ?? preferred;
  }

  /** Build the classification prompt sent to the router model. */
  private buildClassifyPrompt(
    userMessage: string,
    context: {
      activeFileSnippet?: string;
      diagnosticsSummary?: string;
      availableModels:     string[];
    },
  ): string {
    const parts: string[] = [
      `User message: "${userMessage}"`,
      `Available models: ${context.availableModels.join(', ')}`,
    ];

    if (context.activeFileSnippet) {
      parts.push(`\nActive file (first 600 chars):\n${context.activeFileSnippet.slice(0, 600)}`);
    }
    if (context.diagnosticsSummary) {
      parts.push(`\nCurrent file errors:\n${context.diagnosticsSummary}`);
    }

    return parts.join('\n');
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const modelRouter = new ModelRouter();

