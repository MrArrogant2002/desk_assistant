export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function isOnline(): Promise<boolean> {
  try {
    const r = await fetch('https://dns.google', {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    });
    return r.ok || r.status < 500;
  } catch { return false; }
}

export async function searchWeb(query: string, source = 'web'): Promise<SearchResult[]> {
  if (!await isOnline()) {
    throw new Error('Offline: internet not available');
  }
  switch (source) {
    case 'npm':  return searchNpm(query);
    case 'pypi': return searchPypi(query);
    case 'wiki': return searchWiki(query);
    default:     return searchDuckDuckGo(query);
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) { throw new Error('DuckDuckGo error: ' + r.status); }
  const d = await r.json() as {
    AbstractTitle?: string;
    AbstractURL?: string;
    AbstractText?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const results: SearchResult[] = [];
  if (d.AbstractText) {
    results.push({
      title: d.AbstractTitle || query,
      url: d.AbstractURL || '',
      snippet: d.AbstractText,
    });
  }
  for (const t of (d.RelatedTopics || []).slice(0, 5)) {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
    }
  }
  return results.slice(0, 5);
}

async function searchNpm(query: string): Promise<SearchResult[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) { throw new Error('npm registry error: ' + r.status); }
  const d = await r.json() as {
    objects: Array<{ package: { name: string; description: string; links: { npm: string } } }>;
  };
  return (d.objects || []).map(o => ({
    title: o.package.name,
    url: o.package.links?.npm || `https://www.npmjs.com/package/${o.package.name}`,
    snippet: o.package.description || '',
  }));
}

async function searchPypi(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://pypi.org/pypi/${encodeURIComponent(query)}/json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json() as { info: { name: string; summary: string; project_url: string } };
      return [{ title: d.info.name, url: d.info.project_url, snippet: d.info.summary || '' }];
    }
  } catch { /* fallback */ }
  return [{
    title: query,
    url: `https://pypi.org/search/?q=${encodeURIComponent(query)}`,
    snippet: `Search PyPI for: ${query}`,
  }];
}

async function searchWiki(query: string): Promise<SearchResult[]> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) { return []; }
  const d = await r.json() as {
    title: string;
    extract: string;
    content_urls: { desktop: { page: string } };
  };
  return [{
    title: d.title,
    url: d.content_urls?.desktop?.page || '',
    snippet: d.extract || '',
  }];
}
