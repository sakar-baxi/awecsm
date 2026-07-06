export type ParsedCurl = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

/** Parse a cURL command into method, URL, headers, and body. */
export function parseCurl(curl: string): ParsedCurl {
  const raw = curl.trim();
  const flattened = raw.replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  let method = 'GET';
  const methodMatch = flattened.match(/(?:^|\s)(?:-X|--request)\s+([A-Z]+)/i);
  if (methodMatch) method = methodMatch[1].toUpperCase();
  else if (/(?:-d|--data|--data-raw|--data-binary)\s/.test(raw)) method = 'POST';

  let url = '';
  const urlQuoted = [...flattened.matchAll(/'([^']+)'|"([^"]+)"/g)];
  for (const m of urlQuoted) {
    const candidate = (m[1] || m[2] || '').trim();
    if (/^https?:\/\//i.test(candidate)) {
      url = candidate;
      break;
    }
  }
  if (!url) {
    const bare = flattened.match(/(https?:\/\/[^\s'"]+)/i);
    if (bare) url = bare[1];
  }

  const headers: Record<string, string> = {};
  const headerPatterns = [
    /(?:-H|--header)\s+'([^']+)'/gi,
    /(?:-H|--header)\s+"([^"]+)"/gi,
  ];
  headerPatterns.forEach(re => {
    let m;
    while ((m = re.exec(raw)) !== null) {
      const content = m[1];
      const colon = content.indexOf(':');
      if (colon > 0) {
        const key = content.slice(0, colon).trim();
        const val = content.slice(colon + 1).trim();
        if (key.toLowerCase() !== 'authorization' || !/{{\s*token\s*}}/i.test(val)) {
          headers[key] = val;
        }
      }
    }
  });

  let body: string | null = null;
  const bodyPatterns = [
    /(?:-d|--data|--data-raw|--data-binary)\s+'([\s\S]*?)'(?=\s*(?:--|$))/m,
    /(?:-d|--data|--data-raw|--data-binary)\s+"([\s\S]*?)"(?=\s*(?:--|$))/m,
    /(?:-d|--data|--data-raw|--data-binary)\s+(\{[\s\S]*\})/m,
  ];
  for (const re of bodyPatterns) {
    const m = raw.match(re);
    if (m?.[1]) {
      body = m[1].trim();
      break;
    }
  }

  return { method, url, headers, body };
}

export function extractCurlVariables(curl: string): string[] {
  const matches = curl.match(/\{\{([^}]+)\}\}/g) || [];
  return Array.from(
    new Set(
      matches
        .map(m => m.replace(/[{}]/g, '').trim())
        .filter(v => v && v.toLowerCase() !== 'token')
    )
  );
}

export function applyCurlReplacements(
  parsed: ParsedCurl,
  replacements: Record<string, string>
): ParsedCurl {
  const replace = (str: string) => {
    let res = str;
    Object.entries(replacements).forEach(([k, v]) => {
      res = res.split(`{{${k}}}`).join(v ?? '');
    });
    return res;
  };

  const headers: Record<string, string> = {};
  Object.entries(parsed.headers).forEach(([k, v]) => {
    headers[k] = replace(v);
  });

  return {
    method: parsed.method,
    url: replace(parsed.url),
    headers,
    body: parsed.body ? replace(parsed.body) : null,
  };
}

export function validateToolExecution(
  tool: { variables: string[]; name: string },
  ctx: { selectedCredId: string; selectedCorpId: string; vendorOrgId?: string | null; variableValues: Record<string, string> }
): string | null {
  if (!ctx.selectedCredId) return 'Select a client credential first.';
  if (tool.variables.includes('org_id') && !ctx.selectedCorpId) return 'Select a corporate (org) for this tool.';
  if (tool.variables.includes('vendor_org_id') && !ctx.vendorOrgId) {
    return 'Vendor org ID could not be loaded. Re-select the client or check credentials.';
  }
  const customVars = tool.variables.filter(v => v !== 'org_id' && v !== 'vendor_org_id');
  for (const v of customVars) {
    if (!ctx.variableValues[v]?.trim()) return `Fill in required variable: ${v}`;
  }
  return null;
}
