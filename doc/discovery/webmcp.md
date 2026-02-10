# WebMCP Discovery Document

Research into MCP-B: Model Context Protocol for the Browser - a proposed W3C standard for exposing website functionality to AI agents.

**Research Sources:**
- Website: https://mcp-b.ai
- GitHub Org: https://github.com/WebMCP-org
- Documentation: https://docs.mcp-b.ai
- Cloned repositories: `.test-agent/npm-packages`, `.test-agent/examples`

---

# Journal - Initial Discovery & Research Overview

**Date:** 2025-02-10

Began researching MCP-B after discovering it as a browser-native approach to AI agent integration. The project presents itself as an alternative to traditional browser automation (screen scraping, visual parsing) by enabling websites to expose structured tools that AI agents can call directly.

**Key Initial Findings:**

1. **Core Value Proposition:** MCP-B executes browser automation tasks in milliseconds vs. 10-20 seconds for traditional screen scraping, with zero configuration needed
2. **Philosophy:** Human-in-the-loop workflows where AI augments rather than replaces human interaction
3. **Standards-based:** Implements the W3C Web Model Context API proposal being incubated by the Web Machine Learning Community Group

**Architecture Overview:**
- Web pages expose tools via `navigator.modelContext.registerTool()`
- Browser extension collects tools from all open tabs
- Optional native host bridges to desktop AI clients (Claude Desktop, Claude Code)
- Transport layers handle communication between contexts

**Follow-up Questions:**
- How does the protocol handle authentication securely?
- What are the transport implementation details?
- How does the TypeScript SDK differ from the official MCP SDK?

---

# Journal - Protocol Architecture & Transport Layer

**Date:** 2025-02-10

Dove deep into the transport layer implementations. MCP-B provides multiple transport types for different communication scenarios:

## Transport Types

### 1. Tab Transports (In-Page Communication)
- **Use case:** Same browser tab communication
- **Implementation:** `TabServerTransport` and `TabClientTransport`
- **Mechanism:** Uses `window.postMessage` with origin validation
- **Security:** CORS-aware with configurable allowed origins

### 2. Iframe Transports (Parent-Child Communication)
- **Use case:** Cross-origin iframe communication
- **Implementation:** `IframeParentTransport` and `IframeChildTransport`
- **Features:** 
  - Automatic ready handshake protocol
  - Cross-origin messaging via `postMessage`
  - Configurable channel IDs for isolation
- **Security:** Origin validation on both parent and child sides

### 3. Extension Transports (Cross-Context Communication)
- **Use case:** Browser extension components (sidebar, popup, background)
- **Implementation:** `ExtensionClientTransport` and `ExtensionServerTransport`
- **Mechanism:** Chrome runtime ports (`chrome.runtime.connect()`)
- **Features:**
  - Keep-alive support with configurable intervals
  - Auto-reconnect capability
  - Cross-extension communication support

## Transport Configuration Options

| Transport | Key Options | Security Notes |
|-----------|-------------|----------------|
| TabServerTransport | `allowedOrigins` array | Never use `['*']` in production |
| TabClientTransport | `targetOrigin` string | Must match server origin |
| IframeParentTransport | `iframe`, `targetOrigin` | Validates child origin |
| IframeChildTransport | `allowedOrigins` array | Whitelist parent origins |
| ExtensionServerTransport | `port`, `keepAlive` | Chrome secure message passing |
| ExtensionClientTransport | `portName`, `autoReconnect` | Uses Chrome runtime ports |

## Security Model

The transport layer implements defense in depth:
1. **Origin validation** at every boundary
2. **Channel isolation** via configurable channel IDs
3. **Ready handshake** for iframe timing safety
4. **Automatic cleanup** when tabs close
5. **Keep-alive** for connection stability

**Key Insight:** The dual-server mode in `@mcp-b/global` automatically enables both Tab and Iframe servers, making tools accessible from same-window clients AND parent pages when in an iframe. This is crucial for the MCP-UI integration pattern.

---

# Journal - TypeScript SDK Deep Dive

**Date:** 2025-02-10

Investigated the `@mcp-b/webmcp-ts-sdk` package, which is a fork/modification of the official MCP TypeScript SDK.

## Why a Modified SDK?

The official MCP SDK has a critical restriction:
```typescript
public registerCapabilities(capabilities: ServerCapabilities): void {
    if (this.transport) {
        throw new Error('Cannot register capabilities after connecting to transport');
    }
    // ...
}
```

This is incompatible with browser-based MCP because:
1. Web pages register tools dynamically as JavaScript executes
2. Transport must be ready immediately on page load
3. Tools arrive after initialization (e.g., React components mounting)

## The Solution

`BrowserMcpServer` extends `McpServer` with pre-registered capabilities:

```typescript
export class BrowserMcpServer extends BaseMcpServer {
  constructor(serverInfo, options?) {
    // Pre-register tool capabilities in constructor
    const enhancedOptions = {
      ...options,
      capabilities: mergeCapabilities(options?.capabilities || {}, {
        tools: { listChanged: true }
      })
    };
    super(serverInfo, enhancedOptions);
  }
}
```

**Key Difference:** Capabilities are registered **before** connecting, bypassing the restriction.

## Comparison: Official SDK vs @mcp-b/webmcp-ts-sdk

| Feature | Official SDK | @mcp-b/webmcp-ts-sdk |
|---------|--------------|----------------------|
| Tool registration before connect | ✅ Yes | ✅ Yes |
| Tool registration after connect | ❌ No | ✅ Yes |
| Static server capabilities | ✅ Yes | ✅ Yes |
| Dynamic capability announcements | ❌ No | ✅ Yes (tools) |
| `listChanged` capability | Manual | ✅ Pre-registered |

## Use Cases

1. **Web Model Context API:** Primary use case - enables `navigator.modelContext.provideContext()` to work
2. **Single-Page Applications:** Perfect for SPAs where tools register as components mount
3. **Dynamic Tool Lifecycle:** Register in `useEffect`, unregister on component unmount

## Maintenance Strategy

The package is designed for minimal maintenance:
- ~50 lines of custom code
- Automatic updates via official SDK dependency
- Single modification point (capability registration)
- Type-safe (no prototype hacks)

**Key Insight:** This is a minimal, surgical modification that solves a fundamental incompatibility between MCP's design (static servers) and web apps (dynamic tool registration).

---

# Journal - Global Package & W3C API Implementation

**Date:** 2025-02-10

Explored `@mcp-b/global`, the core package implementing the W3C Web Model Context API polyfill.

## Installation Methods

### IIFE Script Tag (Easiest)
```html
<script src="https://unpkg.com/@mcp-b/global@latest/dist/index.iife.js"></script>
```
- Self-contained, 285KB minified
- Auto-initializes `window.navigator.modelContext`
- No build step required
- Also exposes `window.WebMCP` for advanced usage

### NPM/Bundler
```bash
npm install @mcp-b/global
```
```javascript
import '@mcp-b/global';
// navigator.modelContext is now available
```

## The Two-Bucket Tool Management System

WebMCP uses a sophisticated two-bucket approach:

### Bucket A: Base Tools (via `provideContext()`)
- **Purpose:** Application-level base tools
- **Behavior:** Replaces ALL base tools on each call
- **Use case:** Top-level app tools
- **Warning:** Overwrites existing base tools

### Bucket B: Dynamic Tools (via `registerTool()`)
- **Purpose:** Component-level, dynamic tools
- **Behavior:** Persists independently of base tools
- **Use case:** React/Vue component lifecycle
- **Benefit:** Can be individually unregistered

**Recommended Pattern:** Use `registerTool()` for 99% of use cases. Only use `provideContext()` for top-level base tools.

## Tool Registration API

### Recommended: `registerTool()`
```javascript
const registration = navigator.modelContext.registerTool({
  name: "add-todo",
  description: "Add a new todo item",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" }
    },
    required: ["text"]
  },
  async execute({ text }) {
    // Implementation
    return {
      content: [{ type: "text", text: `Added: "${text}"` }]
    };
  }
});

// Cleanup when no longer needed
registration.unregister();
```

### Tool Descriptor Requirements

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Unique identifier (kebab-case recommended) |
| `description` | `string` | Natural language description |
| `inputSchema` | `object` | JSON Schema for input validation |
| `execute` | `function` | Async function implementing tool logic |

### Response Format
```typescript
{
  content: [
    {
      type: "text",      // or "image", "resource"
      text: "Result..."
    }
  ],
  isError?: boolean     // Optional error flag
}
```

## Dual-Server Mode

By default, `@mcp-b/global` runs **two MCP servers** sharing the same tool registry:

1. **Tab Server** (`TabServerTransport`): Same-window communication
2. **Iframe Server** (`IframeChildTransport`): Auto-enabled when `window.parent !== window`

This enables tools to be accessed from:
- Same-window clients (browser extension content scripts)
- Parent pages (when app runs in iframe)

### Configuration Example
```typescript
import { initializeWebModelContext } from '@mcp-b/global';

initializeWebModelContext({
  transport: {
    tabServer: {
      allowedOrigins: ['*'],  // OK for same-window
    },
    iframeServer: {
      allowedOrigins: ['https://parent-app.com'],  // Explicit for security
    },
  },
});
```

### Security Warning
Never use `allowedOrigins: ['*']` for iframe server in production. Always specify explicit parent origins.

---

# Journal - Chrome Extension Deep Dive

**Date:** 2025-02-10

Investigated the MCP-B Chrome Extension, which serves as the bridge between web pages and desktop AI clients.

## Extension Components

### 1. Agent Interface
- Chat interface with 4 specialized AI agents
- Each agent optimized for different tasks
- Switch between agents based on current needs

### 2. Userscript Manager
- Create, edit, enable, disable, organize userscripts
- Export/import functionality for sharing
- AI-assisted script generation

### 3. MCP Transport Layer
- Browser-specific MCP implementation
- No backend servers required
- Works entirely in browser

### 4. Extension Tools
- DOM inspection utilities
- Tab management
- Userscript execution
- Browser automation primitives

### 5. Native Host Bridge (Optional)
- Connects browser MCP to filesystem-based MCP servers
- Enables use of browser tools from Claude Code, Claude Desktop
- Uses native messaging

## The Four Specialized Agents

1. **Userscript Engineer**
   - Build custom scripts to enhance websites
   - Add dark modes, remove ads, custom layouts
   - Production-grade userscript development

2. **WebMCP Server**
   - Turn websites into AI-accessible tools
   - Creates userscripts that register MCP tools
   - Makes website functionality available to AI assistants

3. **Browsing Agent**
   - Navigate and inspect web pages
   - Extract information and gather context
   - Research and monitoring tasks

4. **Chat Companion**
   - Ask questions without automation
   - Get explanations and plan approaches
   - Conversation-focused (not automation)

## Architecture Flow

```
AI Agent (e.g., Claude) 
  ↓
Extension (side panel)
  ↓
MCP Protocol
  ↓
Web Page (via content script)
  ↓
MCP Tools (registered by page or userscripts)
  ↓
Available to AI Agent
```

## Extension Transport Implementation

The extension uses multiple transport layers:

### Background Script (MCP Hub)
```typescript
class McpHub {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: "Extension-Hub",
      version: "1.0.0",
    });
    this.setupConnections();
  }

  private setupConnections() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === "mcp") {
        this.handleUiConnection(port);
      } else if (port.name === "mcp-content-script-proxy") {
        this.handleContentScriptConnection(port);
      }
    });
  }
}
```

### Content Script Bridge
Acts as bridge between page's MCP server and extension:
- Connects to page's MCP server via `TabClientTransport`
- Connects to extension background via `chrome.runtime.connect()`
- Discovers and proxies tools
- Handles tool execution requests

## Use Cases

### Website Customization
- Dark modes
- Ad removal
- Custom layouts
- Keyboard shortcuts

### Automation
- Form filling
- Data extraction
- Price/content monitoring
- Batch actions

### AI Integration
- Search tools for AI
- Action tools (click, submit, navigate)
- Data tools (structured website data)
- Workflow tools (chained actions)

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome | ✅ Fully supported |
| Edge | ✅ Compatible (Chrome Web Store) |
| Brave | ✅ Compatible |
| Firefox | ⚠️ Planned |
| Safari | ⚠️ Under consideration |

## Privacy & Security

- **Local-first:** Userscripts run in browser, no external servers
- **Script review:** Always review before enabling (scripts have website access)
- **Permission model:** Only runs on specified sites
- **Open source:** Core libraries available on GitHub for audit

**Warning:** Userscripts can access/modify website content. Only install from trusted sources.

---

# Journal - Core Packages Overview

**Date:** 2025-02-10

Analyzed the complete package structure in `npm-packages` monorepo.

## Package Inventory

| Package | Purpose | NPM Link |
|---------|---------|----------|
| `@mcp-b/global` | W3C Web Model Context API polyfill | [npm](https://www.npmjs.com/package/@mcp-b/global) |
| `@mcp-b/react-webmcp` | React hooks for WebMCP | [npm](https://www.npmjs.com/package/@mcp-b/react-webmcp) |
| `@mcp-b/transports` | Browser transport implementations | [npm](https://www.npmjs.com/package/@mcp-b/transports) |
| `@mcp-b/webmcp-ts-sdk` | Modified TypeScript SDK | [npm](https://www.npmjs.com/package/@mcp-b/webmcp-ts-sdk) |
| `@mcp-b/extension-tools` | Chrome Extension API wrappers | [npm](https://www.npmjs.com/package/@mcp-b/extension-tools) |
| `@mcp-b/types` | Shared TypeScript types | - |
| `@mcp-b/usewebmcp` | Vue/React composables | - |
| `@mcp-b/chrome-devtools-mcp` | Chrome DevTools integration | - |
| `@mcp-b/smart-dom-reader` | DOM reading utilities | - |
| `@mcp-b/mcp-iframe` | Iframe-specific MCP utilities | - |

## Package Dependencies

```
@mcp-b/global
  ├─ @mcp-b/webmcp-ts-sdk (modified SDK)
  ├─ @mcp-b/transports (transport layer)
  └─ @modelcontextprotocol/sdk (official SDK)

@mcp-b/react-webmcp
  └─ @mcp-b/global (core API)

@mcp-b/transports
  └─ @modelcontextprotocol/sdk (official SDK)

@mcp-b/webmcp-ts-sdk
  └─ @modelcontextprotocol/sdk (official SDK)
```

## Repository Structure

```
npm-packages/
├── packages/           # Core packages
│   ├── global/        # W3C API polyfill
│   ├── transports/    # Transport implementations
│   ├── webmcp-ts-sdk/ # Modified SDK
│   ├── react-webmcp/  # React integration
│   ├── extension-tools/ # Chrome extension utilities
│   ├── types/         # Shared types
│   ├── usewebmcp/     # Framework composables
│   ├── chrome-devtools-mcp/ # DevTools integration
│   ├── smart-dom-reader/    # DOM utilities
│   └── mcp-iframe/    # Iframe helpers
├── e2e/               # End-to-end tests
├── docs/              # Documentation
├── templates/         # Starter templates
└── scripts/           # Build scripts
```

## Tech Stack

- **Language:** TypeScript 5.0+
- **Package Manager:** pnpm
- **Build Tool:** Turbo (monorepo orchestration)
- **Linting:** Biome
- **Testing:** E2E tests included
- **CI/CD:** GitHub Actions (`.github/workflows/`)

## Key Dependencies

- `@modelcontextprotocol/sdk` - Official MCP SDK
- `zod` - Schema validation (used in examples)
- Chrome Extension APIs (Manifest V3)

---

# Journal - Examples & Real-World Usage

**Date:** 2025-02-10

Explored the examples repository to understand practical implementations.

## Example Categories

### Framework Examples
- **React:** SPA integration with hooks
- **Angular:** Component-based tool registration
- **Svelte:** Reactive tool management
- **Vanilla:** Pure JavaScript implementation
- **Rails:** Backend-integrated example
- **Phoenix LiveView:** Real-time web framework

### Mini-App Example: TicTacToe

Located in `mcp-ui-webmcp` repository, demonstrates:
- Dual-server mode (Tab + Iframe)
- Component-scoped tools
- Game state exposure to AI

```typescript
// Initialization pattern
import { initializeWebModelContext } from '@mcp-b/global';

initializeWebModelContext({
  transport: {
    tabServer: {
      allowedOrigins: ['*'],
    },
    // iframeServer auto-enabled when in iframe
  },
});

// Game component registers tools
navigator.modelContext.registerTool({
  name: "tictactoe_get_state",
  description: "Get current game state",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return {
      content: [{ type: "text", text: "Game state: X's turn" }]
    };
  }
});
```

## Common Patterns

### React Component Tool Registration
```typescript
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    const registration = window.navigator.modelContext.registerTool({
      name: "component-action",
      description: "Action specific to this component",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        return {
          content: [{ type: "text", text: "Component action executed!" }]
        };
      }
    });

    return () => {
      registration.unregister();
    };
  }, []);

  return <div>My Component</div>;
}
```

### Iframe Integration Pattern
Used in MCP-UI integration where:
1. Chat UI runs in parent page
2. Mini-apps run in iframes
3. Parent communicates via `IframeParentTransport`
4. Child exposes tools via `IframeChildTransport`
5. Both share tool registry for seamless integration

---

# Journal - Comparison with Alternatives

**Date:** 2025-02-10

Compared MCP-B with existing browser automation approaches.

## Traditional Browser Automation (Screen Scraping)

**How it works:**
- AI analyzes screenshots
- Clicks visual elements
- Breaks when UI changes

**Problems:**
- 10-20 seconds per task
- $4-5 in API costs per action
- Multiple model calls for UI parsing
- Brittle, unreliable execution

**Result:** ❌ Poor performance

## Traditional MCP (Remote APIs)

**How it works:**
- Separate auth per service
- OAuth 2.1 implementation needed
- API keys everywhere
- Complex credential management

**Problems:**
- High barrier to entry
- Complex OAuth flows
- Key management overhead

**Result:** ❌ High friction

## MCP-B Bridge (Browser-Native MCP)

**How it works:**
- Run MCP servers inside web pages
- Use existing browser authentication
- Bridge to any MCP client via extension

**Benefits:**
- ✅ Authentication just works (browser sessions)
- ✅ No OAuth 2.1 complexity
- ✅ No API keys to manage
- ✅ Works with any website
- ✅ 10,000x performance improvement
- ✅ Direct API calls in milliseconds

**Result:** ✅ Works instantly

## MCP vs WebMCP

| Aspect | MCP | WebMCP |
|--------|-----|--------|
| Environment | Backend servers | Browser |
| Use case | Server-to-agent | Human-in-the-loop |
| Authentication | OAuth 2.1 | Inherits user session |
| API | MCP SDK | `navigator.modelContext` |

**Complementary:** Use MCP for backend services, WebMCP for browser-based tools.

---

# Journal - Security Model Analysis

**Date:** 2025-02-10

Analyzed the security architecture of MCP-B.

## Security Layers

### 1. Origin-Based Security
- All transports validate origins
- `postMessage` with `targetOrigin` specification
- Never use `['*']` in production for iframes

### 2. Browser Authentication
- Tools inherit user's existing session
- No separate OAuth flows needed
- Respects existing permission models

### 3. Transport Security
- Tab transports: Same-origin validation
- Iframe transports: Origin validation on both sides
- Extension transports: Chrome secure message passing

### 4. Tool Validation
- Input schema validation (JSON Schema/Zod)
- Additional validation in tool implementations
- Error handling with `isError` flag

### 5. Permission Model
- Extension only runs on specified sites
- Users control which scripts run where
- Scripts scoped to specific origins

## Security Best Practices

### For Tool Developers
```javascript
{
  name: "delete-item",
  description: "Delete an item",
  inputSchema: {
    type: "object",
    properties: {
      id: { 
        type: "string", 
        pattern: "^[a-zA-Z0-9]+$"  // Validate format
      }
    },
    required: ["id"]
  },
  async execute({ id }) {
    // Additional validation
    if (!isValidId(id)) {
      return {
        content: [{ type: "text", text: "Invalid ID" }],
        isError: true
      };
    }
    // Proceed with deletion
    await deleteItem(id);
    return {
      content: [{ type: "text", text: "Item deleted" }]
    };
  }
}
```

### For Transport Configuration
```typescript
// ✅ Good - Explicit origins for iframe server
initializeWebModelContext({
  transport: {
    tabServer: {
      allowedOrigins: ['*'],  // OK for same-window
    },
    iframeServer: {
      allowedOrigins: ['https://parent-app.com'],  // Explicit!
    },
  },
});

// ❌ Bad - Wildcard for iframe server
initializeWebModelContext({
  transport: {
    iframeServer: {
      allowedOrigins: ['*'],  // DANGER!
    },
  },
});
```

## Threat Model

**In-scope threats:**
- Unauthorized tool access from malicious origins
- Injection attacks via tool inputs
- Session hijacking via compromised scripts

**Mitigations:**
- Origin whitelist validation
- Input schema validation
- Tool implementation validation
- Content Security Policy (CSP) compatibility

**Out-of-scope (by design):**
- Headless/autonomous agent operation (requires human-in-the-loop)
- Backend service integration (use MCP instead)
- Cross-site request forgery (handled by browser)

---

# Journal - Open Questions & Follow-Up Research

**Date:** 2025-02-10

## Questions Requiring Further Investigation

### Protocol Questions
1. **Standardization Status:** What is the current W3C incubation status? Timeline for standardization?
2. **Browser Vendor Interest:** Are Chrome, Firefox, Safari, Edge considering native implementation?
3. **MCP Protocol Version:** Which version of MCP spec does WebMCP target?

### Technical Questions
1. **Performance Benchmarks:** Need concrete numbers for tool discovery latency, execution overhead
2. **Scaling Limits:** How many tools can a page register before performance degrades?
3. **Error Handling:** What happens when tools throw errors? How are they propagated?
4. **Resource Management:** How are resources (images, files) handled in tool responses?

### Integration Questions
1. **Framework Integrations:** How well does it work with Next.js, Nuxt, SvelteKit?
2. **State Management:** How to integrate with Redux, Zustand, Pinia?
3. **SSR Compatibility:** Does it work with server-side rendering?

### Ecosystem Questions
1. **Community Adoption:** Who is using this in production?
2. **AI Client Support:** Which AI clients support MCP-B besides Claude?
3. **Extension Distribution:** How many users have the Chrome extension installed?

## Follow-Up Resources to Explore

### Documentation
- [ ] Read complete W3C WebMCP Explainer: https://github.com/webmachinelearning/webmcp
- [ ] Review Microsoft Edge Explainer: https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebModelContext/explainer.md
- [ ] Check MCP specification: https://modelcontextprotocol.io
- [ ] Read native host setup documentation

### Code Exploration
- [ ] Deep dive into `chrome-devtools-mcp` package
- [ ] Analyze `smart-dom-reader` implementation
- [ ] Review `extension-tools` API wrappers
- [ ] Study e2e test suite for usage patterns

### Community
- [ ] Join Discord: https://discord.gg/ZnHG4csJRB
- [ ] Review GitHub issues for common problems
- [ ] Check examples repository for advanced patterns
- [ ] Look at AGENTS.md for contribution guidelines

### Experiments
- [ ] Build a simple todo app with WebMCP
- [ ] Create a userscript with the extension
- [ ] Test iframe integration pattern
- [ ] Benchmark tool registration performance

---

# Journal - W3C Standardization Context

**Date:** 2025-02-10

## WebMCP W3C Status

**Current Status:** Early incubation by Web Machine Learning Community Group

**Explainer Document:** https://github.com/webmachinelearning/webmcp

**Key Points:**
- Standard is still evolving
- Not all MCP-B features may be included in final spec
- APIs subject to change as standard matures
- Being developed alongside browser vendors

## Microsoft Edge Involvement

Microsoft has published their own explainer:
https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebModelContext/explainer.md

This suggests active interest from at least one major browser vendor.

## Comparison to Other W3C AI APIs

WebMCP sits alongside other browser AI standardization efforts:
- **WebNN:** Neural network inference API
- **WebGPU:** GPU compute for ML
- **WebMCP:** High-level agent interaction API

These are complementary layers in the browser AI stack.

## Implications for Developers

**Current State (Polyfill Era):**
- Use `@mcp-b/global` for immediate compatibility
- Expect API evolution as standard matures
- MCP-B provides upgrade path to native implementation

**Future State (Native Support):**
- Browsers implement `navigator.modelContext` natively
- Polyfill becomes optional
- Direct browser integration without extension

**Migration Path:**
Since MCP-B implements the proposed W3C API, code written today should work with native implementations tomorrow. The polyfill is designed to be transparent.

---

# Journal - Summary & Key Takeaways

**Date:** 2025-02-10

## What is MCP-B?

MCP-B is a bridge technology that:
1. **Polyfills** the W3C Web Model Context API (`navigator.modelContext`)
2. **Bridges** WebMCP to the Model Context Protocol (MCP)
3. **Enables** AI agents to call website functions directly

## Why It Matters

**For AI Automation:**
- 10,000x performance improvement over screen scraping
- Zero configuration (uses existing browser auth)
- Works with any website/framework

**For Developers:**
- ~50 lines of code to make site AI-ready
- Type-safe with TypeScript/Zod
- Framework agnostic (React, Vue, vanilla JS)

**For Users:**
- No API keys or OAuth flows
- Privacy-first (local execution)
- Cross-site AI workflows

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Assistants                           │
│         (Claude, ChatGPT, Cursor, etc.)                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ MCP Protocol
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP-B Browser Extension                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Agent Chat   │  │ Userscript   │  │ MCP Hub      │      │
│  │ Interface    │  │ Manager      │  │ (background) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Transport Layer
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Web Pages                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  navigator.modelContext.registerTool()               │  │
│  │  - Exposes JavaScript functions as AI tools          │  │
│  │  - Inherits user authentication                      │  │
│  │  - Type-safe with JSON Schema/Zod                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Key Packages

| Package | Purpose |
|---------|---------|
| `@mcp-b/global` | W3C API polyfill - start here |
| `@mcp-b/transports` | Communication layer |
| `@mcp-b/webmcp-ts-sdk` | Modified MCP SDK for browsers |
| `@mcp-b/react-webmcp` | React hooks |
| `@mcp-b/extension-tools` | Chrome extension utilities |

## Transport Types

1. **Tab Transport** - Same-window communication
2. **Iframe Transport** - Cross-origin parent-child
3. **Extension Transport** - Chrome extension contexts

## Design Philosophy

- **Human-in-the-loop:** AI augments, doesn't replace
- **Zero backend:** Runs entirely in browser
- **Standards-based:** W3C-track specification
- **Secure by default:** Browser auth, origin validation

## Next Steps for Implementation

1. Install `@mcp-b/global`
2. Call `navigator.modelContext.registerTool()` for each function
3. Install MCP-B Chrome Extension for testing
4. Optional: Set up native host for desktop AI integration

## Decision Points

**Use MCP-B when:**
- Website has JavaScript functionality to expose
- Users are present (human-in-the-loop)
- Want to avoid complex OAuth/API keys
- Need fast, reliable AI automation

**Use Traditional MCP when:**
- Backend server-to-agent communication
- No UI present (headless)
- Already have OAuth infrastructure

**Don't use when:**
- Need fully autonomous agents
- Require headless browser automation
- Backend-only integration needed

---

# Reference Links

## Official Resources
- Website: https://mcp-b.ai
- Documentation: https://docs.mcp-b.ai
- GitHub Org: https://github.com/WebMCP-org
- Discord: https://discord.gg/ZnHG4csJRB
- Chrome Extension: https://chromewebstore.google.com/detail/mcp-b-extension/daohopfhkdelnpemnhlekblhnikhdhfa

## Standards & Specifications
- W3C WebMCP Explainer: https://github.com/webmachinelearning/webmcp
- Microsoft Edge Explainer: https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebModelContext/explainer.md
- MCP Specification: https://modelcontextprotocol.io

## NPM Packages
- `@mcp-b/global`: https://www.npmjs.com/package/@mcp-b/global
- `@mcp-b/transports`: https://www.npmjs.com/package/@mcp-b/transports
- `@mcp-b/react-webmcp`: https://www.npmjs.com/package/@mcp-b/react-webmcp
- `@mcp-b/webmcp-ts-sdk`: https://www.npmjs.com/package/@mcp-b/webmcp-ts-sdk
- `@mcp-b/extension-tools`: https://www.npmjs.com/package/@mcp-b/extension-tools

## Local Checkouts
- npm-packages: `.test-agent/npm-packages/`
- examples: `.test-agent/examples/`

---

*Document created: 2025-02-10*
*Research status: Initial comprehensive research complete*
*Next review: After completing follow-up research items*
