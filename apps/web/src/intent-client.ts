export type ActionInput = { path: string; data?: unknown; method?: string };
export type ActionTransport = (input: ActionInput) => Promise<unknown>;

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, ordered(item)]),
    );
  }
  return value;
}

/** An uncertain response must not turn a retry into a second stock/payroll operation. */
export function createIntentSender(transport: ActionTransport) {
  const intents = new Map<string, string>();
  const inFlight = new Map<string, Promise<unknown>>();
  function send(input: ActionInput): Promise<unknown> {
    const method = input.method || "POST";
    const original = input.data;
    const isObject =
      original !== null &&
      typeof original === "object" &&
      !Array.isArray(original);
    const body = isObject
      ? { ...(original as Record<string, unknown>) }
      : original;
    const identifier =
      isObject &&
      typeof (body as Record<string, unknown>).requestId === "string"
        ? "requestId"
        : isObject &&
            typeof (body as Record<string, unknown>).eventId === "string"
          ? "eventId"
          : undefined;
    const supportsIdempotency = !!identifier;
    const normalized = supportsIdempotency
      ? Object.fromEntries(
          Object.entries(body as Record<string, unknown>).filter(
            ([key]) => key !== identifier,
          ),
        )
      : body;
    const signature = `${method} ${input.path} ${JSON.stringify(ordered(normalized))}`;
    const existing = inFlight.get(signature);
    if (existing) return existing;
    if (supportsIdempotency) {
      if (!intents.has(signature))
        intents.set(signature, (body as Record<string, string>)[identifier!]);
      (body as Record<string, unknown>)[identifier!] = intents.get(signature)!;
    }
    const pending = Promise.resolve()
      .then(() => transport({ ...input, method, data: body }))
      .then(
        (result) => {
          intents.delete(signature);
          return result;
        },
        (error) => {
          const status = typeof error?.status === "number" ? error.status : 0;
          if (status >= 400 && status < 500 && status !== 408 && status !== 425)
            intents.delete(signature);
          throw error;
        },
      )
      .finally(() => inFlight.delete(signature));
    inFlight.set(signature, pending);
    return pending;
  }
  return {
    send,
    clear: () => {
      intents.clear();
      inFlight.clear();
    },
  };
}
