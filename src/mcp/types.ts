export interface Agent {
  requestUserInteraction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ToolRegistration {
  unregister(): void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      minimum?: number;
      default?: unknown;
      items?: { type: string };
    }>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>, agent: Agent) => Promise<unknown>;
}

export interface ListCardsParams {
  boardUri?: string;
  columnId?: string;
  includeDescription?: boolean;
}

export interface AddCardParams {
  title: string;
  description?: string;
  boardUri: string;
  columnId: string;
}

export interface UpdateCardParams {
  taskUri: string;
  title?: string;
  description?: string;
  columnId?: string;
}
