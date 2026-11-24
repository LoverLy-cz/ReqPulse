import type { HttpMethod } from '../../shared/types';

export interface ImportedFetchRequest {
  url: string;
  method: HttpMethod;
  headers: Array<{ key: string; value: string }>;
  body: string | null;
  bodyMode: 'json' | 'text';
  referrer: string;
}

const supportedMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function parseCopyAsFetch(source: string): ImportedFetchRequest | null {
  try {
    const input = source.trim();
    const prefix = /^(?:await\s+)?fetch\s*\(\s*/.exec(input);
    if (!prefix) return null;

    const urlLiteral = readStringLiteral(input, prefix[0].length);
    if (!urlLiteral) return null;
    const url = decodeStringLiteral(urlLiteral.value);
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) return null;

    let options: Record<string, unknown> = {};
    const remainder = input.slice(urlLiteral.end).trimStart();
    if (remainder.startsWith(',')) {
      const closingParenthesis = remainder.lastIndexOf(')');
      if (closingParenthesis < 0) return null;
      options = JSON.parse(remainder.slice(1, closingParenthesis).trim()) as Record<string, unknown>;
    }

    const methodValue = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET';
    if (!supportedMethods.includes(methodValue as HttpMethod)) return null;
    const method = methodValue as HttpMethod;
    const headers = parseHeaders(options.headers);
    const referrer = typeof options.referrer === 'string' ? options.referrer : '';
    if (referrer && !headers.some((header) => header.key.toLowerCase() === 'referer')) {
      headers.push({ key: 'Referer', value: referrer });
    }

    const body = typeof options.body === 'string' ? options.body : null;
    const contentType = headers.find((header) => header.key.toLowerCase() === 'content-type')?.value ?? '';
    return {
      url,
      method,
      headers,
      body,
      bodyMode: body && isJsonBody(body, contentType) ? 'json' : 'text',
      referrer,
    };
  } catch {
    return null;
  }
}

function parseHeaders(value: unknown): Array<{ key: string; value: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, headerValue]) => ({ key, value: headerValue }));
}

function readStringLiteral(input: string, start: number): { value: string; end: number } | null {
  const quote = input[start];
  if (quote !== '"' && quote !== "'") return null;
  for (let index = start + 1; index < input.length; index += 1) {
    if (input[index] === '\\') {
      index += 1;
      continue;
    }
    if (input[index] === quote) return { value: input.slice(start, index + 1), end: index + 1 };
  }
  return null;
}

function decodeStringLiteral(literal: string): string {
  if (literal.startsWith('"')) return JSON.parse(literal.replace(/\\:/g, ':')) as string;
  const content = literal.slice(1, -1);
  return content.replace(/\\(['"\\bfnrt:])/g, (_match, escaped: string) => {
    const controls: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    return controls[escaped] ?? escaped;
  });
}

function isJsonBody(body: string, contentType: string): boolean {
  if (!contentType.toLowerCase().includes('json')) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}
