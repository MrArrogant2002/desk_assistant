import { MemoryManager } from '../memoryManager';

export async function queryMemoryTool(
  args: { key?: string; query?: string },
  mem: MemoryManager
): Promise<string> {
  const facts = await mem.getFacts();
  if (!facts.length) { return 'No memories stored yet.'; }

  // Exact key lookup (no semantic needed)
  if (args.key && !args.query) {
    const now = Date.now();
    const f   = facts.find(f => f.key === args.key && (!f.expiresAt || f.expiresAt > now));
    return f ? `${f.key}: ${f.value}` : `No memory found for key: "${args.key}"`;
  }

  // Semantic / keyword search
  const query   = args.query ?? args.key ?? '';
  const summary = await mem.getMemorySummary(query || undefined);
  return summary || 'No relevant memories found.';
}
