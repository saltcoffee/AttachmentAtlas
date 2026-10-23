export function imageFormat(data: ArrayBuffer, path: string): string | null {
  const b = new Uint8Array(data);
  const signature = (offset: number, text: string) =>
    text.split('').every((c, i) => b[offset + i] === c.charCodeAt(0));
  if (/\.png$/i.test(path) && b.length >= 33 && b[0] === 137 && signature(1, 'PNG\r\n\x1a\n')) {
    const view = new DataView(data);
    for (let offset = 8; offset + 12 <= b.length;) {
      const length = view.getUint32(offset);
      if (length > b.length - offset - 12) return null;
      if (signature(offset + 4, 'acTL')) return null;
      if (signature(offset + 4, 'IEND')) return 'PNG';
      offset += length + 12;
    }
    return null;
  }
  if (/\.jpe?g$/i.test(path) && b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return 'JPEG';
  if (/\.webp$/i.test(path) && b.length >= 20 && signature(0, 'RIFF') && signature(8, 'WEBP')) {
    const view = new DataView(data);
    if (view.getUint32(4, true) + 8 !== b.length) return null;
    for (let offset = 12; offset + 8 <= b.length;) {
      const length = view.getUint32(offset + 4, true);
      if (length > b.length - offset - 8) return null;
      if (signature(offset, 'ANIM') || signature(offset, 'ANMF')) return null;
      if (signature(offset, 'VP8X') && (b[offset + 8] ?? 0) & 2) return null;
      offset += 8 + length + (length % 2);
    }
    return 'WebP';
  }
  return null;
}
export function imageDimensions(
  data: ArrayBuffer,
  format: string,
): { width: number; height: number } | null {
  const b = new Uint8Array(data),
    view = new DataView(data);
  if (format === 'PNG' && b.length >= 24)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (format === 'JPEG') {
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset++] !== 255) return null;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === undefined || marker === 217 || marker === 218) return null;
      if (offset + 2 > b.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > b.length) return null;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker))
        return length >= 7
          ? { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) }
          : null;
      offset += length;
    }
  }
  if (format === 'WebP' && b.length >= 30) {
    const chunk = new TextDecoder().decode(b.slice(12, 16));
    if (chunk === 'VP8X')
      return {
        width: 1 + b[24]! + (b[25]! << 8) + (b[26]! << 16),
        height: 1 + b[27]! + (b[28]! << 8) + (b[29]! << 16),
      };
    if (chunk === 'VP8 ' && b[23] === 157 && b[24] === 1 && b[25] === 42)
      return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
  }
  if (format === 'WebP' && b.length >= 25 && b[20] === 47)
    return {
      width: 1 + b[21]! + ((b[22]! & 63) << 8),
      height: 1 + (b[22]! >> 6) + (b[23]! << 2) + ((b[24]! & 15) << 10),
    };
  return null;
}
