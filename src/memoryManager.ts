import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getEmbedding } from './ollamaClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryFact {
  key: string;
  value: string;
  ts: number;
  /** Optional grouping label, e.g. "project", "user", "decision" */
  category?: string;
  /** Unix ms timestamp after which this fact is considered expired and filtered out */
  expiresAt?: number;}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface Session {
  id: string;
  title: string;
  model: string;
  ts: number;         // last-updated timestamp
  messages: SessionMessage[];
  /** Optional: ID of the session this was branched from (item 27) */
  parentId?: string;
  /** Optional: index of the user message at which the branch was created */
  branchPoint?: number;
}

// ─── MemoryManager ───────────────────────────────────────────────────────────

export class MemoryManager {
  private factsPath: string;
  private sessionsDir: string;
  /** In-process cache: avoids re-embedding the same text within a session */
  private embeddingCache = new Map<string, number[]>();

  constructor(globalStorageUri: vscode.Uri) {
    const dir = globalStorageUri.fsPath;
    this.factsPath   = path.join(dir, 'facts.json');
    this.sessionsDir = path.join(dir, 'sessions');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.factsPath), { recursive: true });
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  // ── Global facts ────────────────────────────────────────────────────────────

  async getFacts(): Promise<MemoryFact[]> {
    try {
      return JSON.parse(await fs.readFile(this.factsPath, 'utf8')) as MemoryFact[];
    } catch { return []; }
  }

  async saveFact(key: string, value: string, category?: string, expiresAt?: number): Promise<void> {
    await this.ensureDir();
    const facts = await this.getFacts();
    const idx = facts.findIndex(f => f.key === key);
    const fact: MemoryFact = { key, value, ts: Date.now() };
    if (category)  { fact.category  = category; }
    if (expiresAt) { fact.expiresAt = expiresAt; }
    if (idx >= 0) { facts[idx] = fact; }
    else { facts.push(fact); }
    await fs.writeFile(this.factsPath, JSON.stringify(facts, null, 2), 'utf8');
  }

  async deleteFact(key: string): Promise<void> {
    const facts = (await this.getFacts()).filter(f => f.key !== key);
    await this.ensureDir();
    await fs.writeFile(this.factsPath, JSON.stringify(facts, null, 2), 'utf8');
  }

  /** Alias for deleteFact — matches "/forget <key>" slash command wording */
  async forgetFact(key: string): Promise<void> {
    return this.deleteFact(key);
  }

  /**
   * Return a <memory> block for injection into the system prompt.
   * When `query` is provided and there are more facts than `topK`, performs
   * semantic (cosine) retrieval via Ollama embeddings and injects only the
   * most relevant `topK` facts.  Falls back to keyword matching if Ollama
   * embeddings are unavailable, and to returning all facts if query is absent.
   */
  async getMemorySummary(query?: string, topK = 8): Promise<string> {
    const now   = Date.now();
    const facts = (await this.getFacts()).filter(
      f => f.key !== '__project__' && (!f.expiresAt || f.expiresAt > now)
    );
    if (!facts.length) { return ''; }

    // Semantic / keyword selection
    let selected: MemoryFact[];
    if (query && facts.length > topK) {
      selected = await this.topKFacts(facts, query, topK);
    } else {
      selected = facts.slice(0, topK * 2);   // hard cap even without semantic search
    }

    return this.formatFacts(selected);
  }

  /** Purge facts whose expiresAt timestamp has passed. Returns removed keys. */
  async pruneExpiredFacts(): Promise<string[]> {
    const now     = Date.now();
    const all     = await this.getFacts();
    const alive   = all.filter(f => !f.expiresAt || f.expiresAt > now);
    const removed = all
      .filter(f => f.expiresAt !== undefined && f.expiresAt <= now)
      .map(f => f.key);
    if (removed.length) {
      await this.ensureDir();
      await fs.writeFile(this.factsPath, JSON.stringify(alive, null, 2), 'utf8');
      // Stale facts may be cached — clear entire cache so next query is clean
      this.embeddingCache.clear();
    }
    return removed;
  }

  // ── Semantic retrieval helpers ───────────────────────────────────────────────

  private async topKFacts(facts: MemoryFact[], query: string, topK: number): Promise<MemoryFact[]> {
    const cfg   = vscode.workspace.getConfiguration('deskAssistant');
    const model = cfg.get<string>('summaryModel', 'llama3.2:latest');
    try {
      const queryEmb = await this.embed(query, model);
      const scored: Array<{ fact: MemoryFact; score: number }> = [];
      for (const f of facts) {
        const emb = await this.embed(`${f.key}: ${f.value}`, model);
        scored.push({ fact: f, score: this.cosine(queryEmb, emb) });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map(s => s.fact);
    } catch {
      // Embedding unavailable (model not loaded, Ollama down, etc.) — degrade gracefully
      return this.keywordMatch(facts, query, topK);
    }
  }

  private async embed(text: string, model: string): Promise<number[]> {
    const cacheKey = `${model}:${text}`;
    const cached   = this.embeddingCache.get(cacheKey);
    if (cached) { return cached; }
    const emb = await getEmbedding(text, model);
    this.embeddingCache.set(cacheKey, emb);
    return emb;
  }

  private cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) { return 0; }
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private keywordMatch(facts: MemoryFact[], query: string, topK: number): MemoryFact[] {
    const tokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    if (!tokens.length) { return facts.slice(0, topK); }
    const scored = facts.map(f => ({
      f,
      hits: tokens.filter(t => `${f.key} ${f.value}`.toLowerCase().includes(t)).length,
    }));
    const matched = scored.filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits);
    return (matched.length ? matched : scored).slice(0, topK).map(x => x.f);
  }

  private formatFacts(facts: MemoryFact[]): string {
    const grouped = new Map<string, MemoryFact[]>();
    for (const f of facts) {
      const cat = f.category ?? 'general';
      if (!grouped.has(cat)) { grouped.set(cat, []); }
      grouped.get(cat)!.push(f);
    }
    const sections: string[] = [];
    for (const [cat, items] of grouped) {
      const lines = items.map(f => `  ${f.key}: ${f.value}`).join('\n');
      sections.push(cat === 'general' ? lines : `  [${cat}]\n${lines}`);
    }
    return `<memory>\n${sections.join('\n')}\n</memory>`;
  }

  /** Return the auto-detected project context fact, if present */
  async getProjectContext(): Promise<string> {
    const facts = await this.getFacts();
    const f = facts.find(x => x.key === '__project__');
    return f ? f.value : '';
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────

  private sessionPath(id: string): string {
    return path.join(this.sessionsDir, id + '.json');
  }

  async listSessions(): Promise<Session[]> {
    try {
      await this.ensureDir();
      const files = await fs.readdir(this.sessionsDir);
      const sessions: Session[] = [];
      for (const f of files.filter(x => x.endsWith('.json'))) {
        try {
          const s = JSON.parse(await fs.readFile(path.join(this.sessionsDir, f), 'utf8')) as Session;
          // Return without messages for lightweight listing
          sessions.push({ ...s, messages: [] });
        } catch { /* corrupt file, skip */ }
      }
      return sessions.sort((a, b) => b.ts - a.ts);
    } catch { return []; }
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      return JSON.parse(await fs.readFile(this.sessionPath(id), 'utf8')) as Session;
    } catch { return null; }
  }

  async saveSession(session: Session): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8');
  }

  async deleteSession(id: string): Promise<void> {
    try { await fs.unlink(this.sessionPath(id)); } catch { /* already gone */ }
  }

  async createSession(model: string): Promise<Session> {
    await this.ensureDir();
    const session: Session = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: 'New chat',
      model,
      ts: Date.now(),
      messages: [],
    };
    await this.saveSession(session);
    return session;
  }

  /**
   * Item 27 — Fork a session from a given user message index.
   *
   * Loads the source session, copies messages up to and including the
   * `fromUserMsgIndex`-th user message (0-based counting only user turns),
   * creates a new session with those messages and parentId set, and returns it.
   */
  async forkSession(fromId: string, fromUserMsgIndex: number): Promise<Session | null> {
    const src = await this.loadSession(fromId);
    if (!src) { return null; }

    // Walk messages and keep everything up to and including the N-th user msg
    const keep: SessionMessage[] = [];
    let userCount = -1;
    for (const msg of src.messages) {
      if (msg.role === 'user') { userCount++; }
      keep.push(msg);
      if (msg.role === 'user' && userCount === fromUserMsgIndex) { break; }
    }

    await this.ensureDir();
    const forked: Session = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '🌿 ' + src.title.replace(/^🌿\s*/, '').slice(0, 55),
      model: src.model,
      ts: Date.now(),
      messages: keep,
      parentId:    fromId,
      branchPoint: fromUserMsgIndex,
    };
    await this.saveSession(forked);
    return forked;
  }

  /** Auto-title session from first user message. Only sets title once. */
  async autoTitleSession(session: Session, firstUserMsg: string): Promise<Session> {
    if (session.title !== 'New chat') { return session; }
    const title = firstUserMsg.replace(/<[^>]+>/g, '').trim().slice(0, 60) || 'Chat';
    session.title = title;
    session.ts    = Date.now();
    await this.saveSession(session);
    return session;
  }

  async appendToSession(
    session: Session,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    const MAX = 200;
    session.messages.push({ role, content, ts: Date.now() });
    if (session.messages.length > MAX) { session.messages = session.messages.slice(-MAX); }
    session.ts = Date.now();
    await this.saveSession(session);
  }

  /** Purge sessions that use a model that is no longer installed. */
  async pruneOrphanedModelSessions(installedModels: string[]): Promise<string[]> {
    const all = await this.listSessions();
    const removed: string[] = [];
    for (const s of all) {
      if (s.model && !installedModels.includes(s.model)) {
        // Move title to removed list; delete session file
        await this.deleteSession(s.id);
        removed.push(s.title);
      }
    }
    return removed;
  }

  // ── Item 21: Project memory ───────────────────────────────────────────────
  /**
   * Scan the workspace root for well-known project descriptor files and build
   * a concise summary string describing the project type, name, and tooling.
   * The result is stored as the "__project__" special fact so it survives
   * restarts and is injected into the system prompt on every session.
   */
  async detectProjectContext(wsRoot: string): Promise<void> {
    const parts: string[] = [];
    const tryRead = async (file: string): Promise<string | null> => {
      try { return await fs.readFile(path.join(wsRoot, file), 'utf8'); }
      catch { return null; }
    };

    // Node / JavaScript / TypeScript
    const pkgJson = await tryRead('package.json');
    if (pkgJson) {
      try {
        const pkg = JSON.parse(pkgJson) as {
          name?: string; version?: string; description?: string;
          scripts?: Record<string, string>; dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const scripts = Object.keys(pkg.scripts ?? {}).join(', ') || 'none';
        const mainDeps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).slice(0, 10).join(', ');
        parts.push(`Node.js project: name="${pkg.name ?? 'unknown'}" version="${pkg.version ?? '?'}" description="${pkg.description ?? ''}" scripts=[${scripts}] key-deps=[${mainDeps}]`);
      } catch { parts.push('Node.js project (package.json parse error)'); }
    }

    // Python
    const reqTxt = await tryRead('requirements.txt');
    if (reqTxt) {
      const deps = reqTxt.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 10).join(', ');
      parts.push(`Python project (requirements.txt). Key deps: [${deps}]`);
    }
    const pyproject = await tryRead('pyproject.toml');
    if (pyproject && !reqTxt) {
      const nameMatch = pyproject.match(/name\s*=\s*"([^"]+)"/);
      parts.push(`Python project (pyproject.toml)${nameMatch ? ': name="' + nameMatch[1] + '"' : ''}`);
    }

    // Rust
    const cargoToml = await tryRead('Cargo.toml');
    if (cargoToml) {
      const nameMatch = cargoToml.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = cargoToml.match(/version\s*=\s*"([^"]+)"/);
      parts.push(`Rust project (Cargo.toml)${nameMatch ? ': name="' + nameMatch[1] + '"' : ''}${versionMatch ? ' v' + versionMatch[1] : ''}`);
    }

    // Go
    const goMod = await tryRead('go.mod');
    if (goMod) {
      const moduleMatch = goMod.match(/^module\s+(\S+)/m);
      parts.push(`Go module${moduleMatch ? ': ' + moduleMatch[1] : ' (go.mod)'}`);
    }

    // .NET / C#
    const csprojFiles = await fs.readdir(wsRoot).then(entries =>
      entries.filter(e => e.endsWith('.csproj'))
    ).catch(() => [] as string[]);
    if (csprojFiles.length) {
      parts.push(`.NET/C# project: ${csprojFiles.join(', ')}`);
    }

    if (!parts.length) { return; } // nothing detected

    const value = parts.join(' | ');
    await this.saveFact('__project__', value, 'project');
  }
}

