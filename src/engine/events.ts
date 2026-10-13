/** Minimal typed event bus. Mods and UI subscribe here; the simulation emits. */
export type Handler<T = any> = (payload: T) => void;

export class EventBus<Events extends Record<string, any> = Record<string, any>> {
  private handlers = new Map<string, Set<Handler>>();

  on<K extends keyof Events & string>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Subscribe to every event (wildcard). */
  onAny(fn: (type: string, payload: any) => void): () => void {
    return this.on('*' as any, ((e: { type: string; payload: any }) => fn(e.type, e.payload)) as any);
  }

  emit<K extends keyof Events & string>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) safe(fn, payload);
    const any = this.handlers.get('*');
    if (any) for (const fn of any) safe(fn, { type, payload });
  }

  clear(): void {
    this.handlers.clear();
  }
}

function safe(fn: Handler, payload: unknown) {
  try {
    fn(payload);
  } catch (err) {
    console.error('[event handler]', err);
  }
}
