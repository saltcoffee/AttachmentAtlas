import { digest, MAX_IMAGE } from '../domain/model';
globalThis.onmessage = (event: MessageEvent<unknown>) => {
  const message = event.data as { version?: unknown; id?: unknown; data?: unknown } | null;
  if (
    !message ||
    message.version !== 1 ||
    !Number.isSafeInteger(message.id) ||
    !(message.data instanceof ArrayBuffer) ||
    message.data.byteLength > MAX_IMAGE
  )
    return;
  const { id, data } = message;
  void digest(data)
    .then((hash) => globalThis.postMessage({ version: 1, id, hash }))
    .catch(() => globalThis.postMessage({ version: 1, id, error: 'Image fingerprint failed.' }));
};
