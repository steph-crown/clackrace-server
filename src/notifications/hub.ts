type SseClient = {
  userId: string;
  write: (chunk: string) => void;
  close: () => void;
};

const clients = new Map<string, Set<SseClient>>();

export function addSseClient(client: SseClient): () => void {
  let set = clients.get(client.userId);
  if (!set) {
    set = new Set();
    clients.set(client.userId, set);
  }
  set.add(client);
  return () => {
    set!.delete(client);
    if (set!.size === 0) clients.delete(client.userId);
  };
}

export function isUserOnline(userId: string): boolean {
  return (clients.get(userId)?.size ?? 0) > 0;
}

export function pushToUser(
  userId: string,
  event: string,
  data: unknown,
): boolean {
  const set = clients.get(userId);
  if (!set || set.size === 0) return false;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of set) {
    try {
      c.write(payload);
    } catch {
      /* drop broken pipe */
    }
  }
  return true;
}
