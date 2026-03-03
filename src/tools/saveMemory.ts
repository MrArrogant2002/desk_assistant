import { MemoryManager } from '../memoryManager';

export async function saveMemoryTool(
  args: { key: string; value: string; category?: string; ttlDays?: number },
  mem: MemoryManager
): Promise<string> {
  if (!args.key || !args.value) { return 'Error: key and value are required'; }
  const expiresAt = args.ttlDays && args.ttlDays > 0
    ? Date.now() + args.ttlDays * 86_400_000
    : undefined;
  await mem.saveFact(args.key.trim(), args.value.trim(), args.category, expiresAt);
  const extra = [
    args.category ? `category: ${args.category}` : '',
    args.ttlDays  ? `expires in ${args.ttlDays}d` : '',
  ].filter(Boolean).join(', ');
  return `Memory saved: "${args.key}" = "${args.value}"${extra ? ` (${extra})` : ''}`;
}
