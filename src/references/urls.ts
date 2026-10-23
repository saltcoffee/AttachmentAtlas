/** External application URLs are not vault paths; filesystem URLs remain unresolved. */
export function externalLink(value: string): boolean {
  if (value.startsWith('//')) return true;
  const scheme = /^([a-z][\w+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (!scheme || ['file', 'app', 'javascript', 'vbscript'].includes(scheme)) return false;
  return (
    ['http', 'https', 'data', 'mailto', 'obsidian', 'tel', 'sms', 'weread', 'zotero'].includes(
      scheme,
    ) ||
    (scheme.length > 1 && value.slice(scheme.length + 1).startsWith('//'))
  );
}
