import {
  createListCardsTool,
  createAddCardTool,
  createUpdateCardTool,
} from "./card-tools.js";
import type { ToolDefinition, ToolRegistration } from "./types.js";

type ModelContext = {
  registerTool(tool: ToolDefinition): ToolRegistration;
};

declare global {
  interface Navigator {
    modelContext?: ModelContext;
  }
}

let registrations: ToolRegistration[] = [];

export function registerCardMCPTools(): void {
  if (typeof navigator === "undefined" || !("modelContext" in navigator)) {
    console.log("WebMCP not available - tools will not be registered");
    return;
  }

  const tools: ToolDefinition[] = [
    createListCardsTool(),
    createAddCardTool(),
    createUpdateCardTool(),
  ];

  for (const tool of tools) {
    const registration = navigator.modelContext!.registerTool(tool);
    registrations.push(registration);
  }

  console.log(`Registered ${tools.length} Skyboard WebMCP tools`);
  window.dispatchEvent(new CustomEvent("skyboard-mcp-ready"));
}

export function unregisterCardMCPTools(): void {
  for (const registration of registrations) {
    registration.unregister();
  }
  registrations = [];
  console.log("Unregistered Skyboard WebMCP tools");
}

export function setCurrentUserDid(did: string): void {
  (window as unknown as { skyboardCurrentDid?: string }).skyboardCurrentDid = did;
}

export function getCurrentUserDid(): string | undefined {
  return (window as unknown as { skyboardCurrentDid?: string }).skyboardCurrentDid;
}

export function initMCPProvider(did: string): void {
  setCurrentUserDid(did);
  registerCardMCPTools();
}
