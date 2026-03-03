import { searchWeb } from '../webSearch';

export async function searchWebTool(
  args: { query: string; source?: string }
): Promise<string> {
  if (!args.query) { return 'Error: query is required'; }
  try {
    const results = await searchWeb(args.query, args.source ?? 'web');
    if (!results.length) { return 'No results found for: ' + args.query; }
    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`)
      .join('\n\n');
  } catch (e) {
    return 'Search error: ' + (e instanceof Error ? e.message : String(e));
  }
}
