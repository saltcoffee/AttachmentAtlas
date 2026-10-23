import LZString from 'lz-string';
import { assert } from '../domain/model';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_CHARACTERS = 4 * 1024 * 1024;

/**
 * LZ-String dictionary decoding, adapted with input, output and dictionary limits.
 * Format/algorithm: Pieroxy, MIT; see lz-string in THIRD_PARTY_NOTICES.md.
 * The upstream encoder also verifies that no truncated or trailing data was accepted.
 */
export function decompressScene(value: string, limit = MAX_CHARACTERS): string {
  const input = value.replace(/\s/g, '');
  assert(limit > 0 && limit <= MAX_CHARACTERS, 'Invalid Excalidraw decompression budget.');
  assert(
    input.length > 0 && /^[A-Za-z0-9+/]+={0,3}$/.test(input),
    'Invalid compressed Excalidraw data.',
  );
  let position = 0;
  const bits = (count: number): number => {
    let value = 0;
    for (let bit = 0; bit < count; bit++) {
      const character = input[Math.floor(position / 6)];
      const code = character === undefined ? -1 : ALPHABET.indexOf(character);
      assert(code >= 0, 'Truncated compressed Excalidraw data.');
      value += ((code >> (5 - (position % 6))) & 1) * 2 ** bit;
      position++;
    }
    return value;
  };
  const first = bits(2);
  assert(first === 0 || first === 1, 'Invalid compressed Excalidraw data.');
  let previous = String.fromCharCode(bits(first === 0 ? 8 : 16));
  const dictionary: string[] = ['', '', '', previous];
  const output = [previous];
  let characters = previous.length,
    dictionaryCharacters = previous.length;
  let width = 3,
    remaining = 4;
  const insert = (entry: string) => {
    dictionaryCharacters += entry.length;
    assert(
      dictionary.length < 100_000 && dictionaryCharacters <= 16 * 1024 * 1024,
      'Excalidraw scene exceeds the parsing budget.',
    );
    dictionary.push(entry);
  };
  const grow = () => {
    if (remaining === 0) {
      remaining = 2 ** width;
      width++;
    }
  };
  for (;;) {
    let code = bits(width);
    if (code === 2) {
      const result = output.join('');
      assert(LZString.compressToBase64(result) === input, 'Invalid compressed Excalidraw data.');
      return result;
    }
    if (code === 0 || code === 1) {
      const literal = String.fromCharCode(bits(code === 0 ? 8 : 16));
      code = dictionary.length;
      insert(literal);
      remaining--;
      grow();
    }
    const entry = code === dictionary.length ? previous + previous[0] : dictionary[code];
    assert(entry !== undefined && entry.length > 0, 'Invalid compressed Excalidraw data.');
    characters += entry.length;
    assert(characters <= limit, 'Excalidraw scene exceeds the parsing budget.');
    output.push(entry);
    insert(previous + entry[0]);
    remaining--;
    grow();
    previous = entry;
  }
}
