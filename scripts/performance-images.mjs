import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { crc32 } from 'node:zlib';

// Locally encoded 2×2 RGB seeds. Padding changes file bytes, never the decoded pixels.
const seeds = {
  png: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQDsgDIgYIBQAXfgOFJRqK6QAAAABJRU5ErkJggg==',
    'base64',
  ),
  jpg: Buffer.from(
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+F6KKK/XD8bP/9k=',
    'base64',
  ),
  webp: Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQqI7Urf+BiOh/AAA=', 'base64'),
};

export function performanceImage(size, identity, format = 'png') {
  assert(Number.isSafeInteger(size) && size >= 2048 && size % 2 === 0);
  assert(Object.hasOwn(seeds, format), 'Unknown fixture image format.');
  const seed = seeds[format],
    data = Buffer.alloc(size, 97);
  if (format === 'png') {
    const at = seed.length - 12,
      length = size - seed.length - 12;
    seed.copy(data, 0, 0, at);
    data.writeUInt32BE(length, at);
    data.write('tEXt', at + 4);
    data.write(`identity\0${identity}`, at + 8);
    data.writeUInt32BE(crc32(data.subarray(at + 4, at + 8 + length)), at + 8 + length);
    seed.copy(data, at + length + 12, at);
  } else if (format === 'webp') {
    seed.copy(data);
    data.writeUInt32LE(size - 8, 4);
    data.write('JUNK', seed.length);
    data.writeUInt32LE(size - seed.length - 8, seed.length + 4);
    data.write(identity, seed.length + 8);
  } else {
    seed.copy(data, 0, 0, 2);
    let remaining = size - seed.length,
      at = 2;
    while (remaining) {
      let bytes = Math.min(remaining, 65537);
      if (remaining - bytes > 0 && remaining - bytes < 4) bytes -= 4;
      data.writeUInt16BE(0xfffe, at);
      data.writeUInt16BE(bytes - 2, at + 2);
      data.write(identity, at + 4, Math.min(Buffer.byteLength(identity), bytes - 4));
      remaining -= bytes;
      at += bytes;
    }
    seed.copy(data, at, 2);
  }
  return data;
}
