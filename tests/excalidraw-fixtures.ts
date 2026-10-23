import LZString from 'lz-string';

export function drawing(
  elements: Record<string, unknown>[] = [],
  header = '',
  compressed = true,
  files: Record<string, unknown> = {},
): string {
  const scene = JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: {}, files });
  const payload = compressed
    ? LZString.compressToBase64(scene)
        .match(/.{1,64}/g)!
        .join('\n')
    : scene;
  return `---\nexcalidraw-plugin: parsed\n---\n\n# Excalidraw Data\n\n## Text Elements\n\n${header}\n%%\n## Drawing\n\`\`\`${compressed ? 'compressed-json' : 'json'}\n${payload}\n\`\`\`\n%%\n`;
}
