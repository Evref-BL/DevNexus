export const defaultVibeKanbanHost = "127.0.0.1";

export const vibeKanbanPinnedVersion = "0.1.43";

export interface VibeKanbanApiOptions {
  host?: string;
  port: number;
  fetch?: typeof fetch;
}

export class VibeKanbanApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanApiError";
  }
}

export function vibeKanbanApiBaseUrl(options: VibeKanbanApiOptions): string {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new VibeKanbanApiError(
      "Vibe Kanban port must be an integer between 1 and 65535",
    );
  }

  return `http://${options.host ?? defaultVibeKanbanHost}:${options.port}`;
}
