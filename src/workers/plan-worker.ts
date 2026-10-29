import { buildPlan } from '../application/plan';
import { errorDetail } from '../domain/messages';
import { planBuildInput } from '../infrastructure/plan-protocol';

self.onmessage = (event: MessageEvent<unknown>) => {
  const input = planBuildInput.safeParse(event.data);
  if (!input.success) {
    const envelope = event.data as { id?: unknown } | null;
    if (envelope && Number.isSafeInteger(envelope.id))
      self.postMessage({
        version: 1,
        id: envelope.id,
        ok: false,
        error: 'Invalid preview worker request.',
      });
    return;
  }
  const { id, snapshot, selection } = input.data;
  try {
    self.postMessage({ version: 1, id, ok: true, plan: buildPlan(snapshot, selection) });
  } catch (error) {
    self.postMessage({ version: 1, id, ok: false, error: errorDetail(error) });
  }
};
