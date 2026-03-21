import { EventEmitter } from "events";

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publishRunEvent(runId: string, data: object): void {
  emitter.emit(`run:${runId}`, data);
}

export function subscribeToRun(
  runId: string,
  handler: (data: object) => void
): () => void {
  emitter.on(`run:${runId}`, handler);
  return () => emitter.off(`run:${runId}`, handler);
}
