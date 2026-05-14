# WebMCP Provider Guide

A comprehensive guide for web developers implementing WebMCP to expose their application's functionality to AI agents and browser assistants.

**Specification:** W3C WebMCP (webmachinelearning/webmcp)  
**Target Audience:** Web developers adding WebMCP to existing web applications  
**Last Updated:** 2025-02-10

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Concepts for Providers](#core-concepts-for-providers)
3. [Tool Design Patterns](#tool-design-patterns)
4. [Advanced Capabilities](#advanced-capabilities)
5. [Security Best Practices](#security-best-practices)
6. [Integration Patterns](#integration-patterns)
7. [Testing & Validation](#testing--validation)
8. [Real-World Examples](#real-world-examples)

---

## Quick Start

### Minimum Viable WebMCP Implementation

Add this to any existing web page to expose a single capability:

```javascript
// Check if WebMCP is available
if ('modelContext' in navigator) {
    // Register a simple tool
    navigator.modelContext.registerTool({
        name: "get-page-info",
        description: "Get information about the current page",
        inputSchema: {
            type: "object",
            properties: {}
        },
        execute: async () => {
            return {
                title: document.title,
                url: window.location.href,
                timestamp: new Date().toISOString()
            };
        }
    });
}
```

### Progressive Enhancement Pattern

```javascript
// Wrap WebMCP in a feature detection pattern
function initializeWebMCP() {
    if (!('modelContext' in navigator)) {
        console.log('WebMCP not available - agents will use traditional methods');
        return;
    }

    // Register your tools
    registerApplicationTools();
    
    // Notify that MCP is ready (optional)
    window.dispatchEvent(new CustomEvent('webmcp-ready'));
}

// Call when DOM is ready
document.addEventListener('DOMContentLoaded', initializeWebMCP);
```

---

## Core Concepts for Providers

### What You're Building

As a WebMCP provider, you're creating **tools** - JavaScript functions that:
- Have natural language descriptions
- Accept structured parameters (with schemas)
- Execute in the browser context
- Return structured results
- May interact with your UI or backend APIs

### The Provider-AI-Agent Relationship

```
┌────────────────────────────────────────────────────────────────┐
│                        Web Page (Your App)                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Tool Registry (navigator.modelContext)                 │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │  Tool A     │  │  Tool B     │  │  Tool C     │     │   │
│  │  │  (Search)   │  │  (Filter)   │  │  (Purchase) │     │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │   │
│  │         └─────────────────┴─────────────────┘          │   │
│  │                         │                              │   │
│  │                         ▼                              │   │
│  │              Your Application Code                     │   │
│  │              (State, UI, APIs)                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
        ┌───────────────┐       ┌───────────────┐
        │  Browser      │       │  AI Agent     │
        │  (Mediator)   │◄─────►│  (Claude,     │
        │               │       │   Copilot,    │
        └───────────────┘       │   etc.)       │
                                └───────────────┘
```

### Key Design Principles

1. **Human-in-the-Loop**: Users should always be present when agents act
2. **UI Cooperation**: Tools should update the UI so users see what's happening
3. **State Consistency**: Tools work with the same state as user interactions
4. **Progressive Disclosure**: Start simple, add complexity as needed

---

## Tool Design Patterns

### Pattern 1: Read-Only Query Tools

**Use Case:** Let agents retrieve information from your app

```javascript
navigator.modelContext.registerTool({
    name: "get-cart-contents",
    description: "Get the current shopping cart contents including items, quantities, and total price",
    inputSchema: {
        type: "object",
        properties: {
            includeRecommendations: {
                type: "boolean",
                description: "Whether to include recommended accessories",
                default: false
            }
        }
    },
    execute: async ({ includeRecommendations = false }) => {
        // Access your existing state management
        const cart = window.cartStore.getState();
        
        const result = {
            items: cart.items.map(item => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                subtotal: item.price * item.quantity
            })),
            total: cart.total,
            itemCount: cart.items.length
        };
        
        if (includeRecommendations && cart.items.length > 0) {
            result.recommendations = await fetchRecommendations(cart.items);
        }
        
        return result;
    }
});
```

**Best Practices:**
- Return structured, typed data
- Include calculated/derived values agents might need
- Don't expose internal IDs unless necessary
- Consider pagination for large datasets

### Pattern 2: State Modification Tools

**Use Case:** Let agents change application state (add items, update settings, etc.)

```javascript
navigator.modelContext.registerTool({
    name: "add-to-cart",
    description: "Add a product to the shopping cart. Updates the cart UI immediately.",
    inputSchema: {
        type: "object",
        properties: {
            productId: {
                type: "string",
                description: "The product ID to add"
            },
            quantity: {
                type: "number",
                description: "How many to add",
                minimum: 1,
                default: 1
            },
            variantId: {
                type: "string",
                description: "Optional product variant (size, color, etc.)"
            }
        },
        required: ["productId"]
    },
    execute: async ({ productId, quantity = 1, variantId }, agent) => {
        // Validate product exists
        const product = await fetchProduct(productId);
        if (!product) {
            throw new Error(`Product ${productId} not found`);
        }
        
        // Check if this requires user confirmation
        if (product.price > 100) {
            const confirmed = await agent.requestUserInteraction(async () => {
                return confirm(
                    `Add ${product.name} (${formatPrice(product.price)}) to cart?`
                );
            });
            
            if (!confirmed) {
                return { 
                    success: false, 
                    reason: "User cancelled",
                    product: { name: product.name, price: product.price }
                };
            }
        }
        
        // Add to cart using your existing logic
        const cartItem = await window.cartStore.addItem({
            productId,
            quantity,
            variantId
        });
        
        // UI is automatically updated by your state management
        return {
            success: true,
            item: cartItem,
            cartTotal: window.cartStore.getState().total,
            message: `Added ${quantity} × ${product.name} to cart`
        };
    }
});
```

**Best Practices:**
- Reuse existing application logic
- Update UI so users see changes immediately
- Use `agent.requestUserInteraction()` for sensitive operations
- Return confirmation details in structured format

### Pattern 3: Navigation & Discovery Tools

**Use Case:** Let agents navigate complex applications or filter large datasets

```javascript
navigator.modelContext.registerTool({
    name: "search-products",
    description: `Search for products using natural language criteria. Examples:
        - "red dresses under $100"
        - "wireless headphones with noise cancellation"
        - "laptops with 16GB RAM for gaming"`,
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Natural language search query"
            },
            filters: {
                type: "object",
                properties: {
                    category: { type: "string" },
                    minPrice: { type: "number" },
                    maxPrice: { type: "number" },
                    inStock: { type: "boolean" }
                }
            },
            sortBy: {
                type: "string",
                enum: ["relevance", "price-low", "price-high", "newest", "rating"],
                default: "relevance"
            },
            limit: {
                type: "number",
                default: 10,
                maximum: 50
            }
        },
        required: ["query"]
    },
    execute: async ({ query, filters = {}, sortBy = "relevance", limit = 10 }) => {
        // Parse natural language query into structured filters
        const searchParams = {
            q: query,
            ...filters,
            sort: sortBy,
            limit
        };
        
        // Use your existing search API
        const results = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchParams)
        }).then(r => r.json());
        
        // Update UI to show results
        window.searchUI.displayResults(results.products);
        
        return {
            totalFound: results.total,
            showing: results.products.length,
            products: results.products.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                rating: p.rating,
                inStock: p.inventory > 0,
                matchReason: p.match_reason // Why this matched the query
            })),
            appliedFilters: results.applied_filters
        };
    }
});
```

**Best Practices:**
- Accept natural language for flexibility
- Return structured data + UI updates
- Include metadata (why results matched)
- Support pagination for large result sets

### Pattern 4: Multi-Step Workflow Tools

**Use Case:** Complex operations that need confirmation at each step

```javascript
navigator.modelContext.registerTool({
    name: "checkout",
    description: "Complete the checkout process for items in cart",
    inputSchema: {
        type: "object",
        properties: {
            shippingAddress: {
                type: "object",
                properties: {
                    street: { type: "string" },
                    city: { type: "string" },
                    zip: { type: "string" },
                    country: { type: "string" }
                }
            },
            paymentMethod: {
                type: "string",
                enum: ["saved-card", "new-card", "paypal"]
            },
            confirmEachStep: {
                type: "boolean",
                default: true,
                description: "Whether to ask for confirmation at each step"
            }
        }
    },
    execute: async (params, agent) => {
        const cart = window.cartStore.getState();
        
        if (cart.items.length === 0) {
            throw new Error("Cart is empty");
        }
        
        const results = {
            stepsCompleted: [],
            orderId: null,
            total: cart.total
        };
        
        // Step 1: Validate shipping
        if (params.confirmEachStep) {
            const shippingConfirmed = await agent.requestUserInteraction(async () => {
                return confirm(
                    `Proceed with checkout?\n` +
                    `Items: ${cart.items.length}\n` +
                    `Total: $${cart.total}\n` +
                    `Shipping to: ${params.shippingAddress?.city || 'Default address'}`
                );
            });
            
            if (!shippingConfirmed) {
                return { cancelled: true, atStep: "shipping" };
            }
        }
        results.stepsCompleted.push("shipping");
        
        // Step 2: Process payment
        try {
            const paymentResult = await processPayment({
                amount: cart.total,
                method: params.paymentMethod
            });
            results.stepsCompleted.push("payment");
            results.paymentId = paymentResult.id;
        } catch (error) {
            throw new Error(`Payment failed: ${error.message}`);
        }
        
        // Step 3: Create order
        const order = await createOrder({
            items: cart.items,
            shipping: params.shippingAddress,
            payment: results.paymentId
        });
        
        results.orderId = order.id;
        results.stepsCompleted.push("order-creation");
        
        // Clear cart
        window.cartStore.clear();
        
        // Navigate to confirmation page
        window.router.navigate(`/orders/${order.id}/confirmation`);
        
        return {
            success: true,
            orderId: order.id,
            total: order.total,
            estimatedDelivery: order.estimated_delivery,
            stepsCompleted: results.stepsCompleted
        };
    }
});
```

**Best Practices:**
- Break complex operations into clear steps
- Confirm sensitive steps with user
- Provide rollback/cancellation at each point
- Return detailed results for agent to report

### Pattern 5: UI Manipulation Tools

**Use Case:** Let agents control UI state (filters, views, modals)

```javascript
navigator.modelContext.registerTool({
    name: "set-view-filter",
    description: "Update the current view filters and display options",
    inputSchema: {
        type: "object",
        properties: {
            dateRange: {
                type: "string",
                enum: ["today", "week", "month", "quarter", "year", "custom"],
                description: "Time period to show"
            },
            groupBy: {
                type: "string",
                enum: ["day", "week", "month", "category", "project"],
                description: "How to group the data"
            },
            filters: {
                type: "object",
                description: "Additional filters to apply",
                properties: {
                    status: { 
                        type: "array", 
                        items: { type: "string" },
                        description: "Statuses to include (e.g., ['active', 'pending'])"
                    },
                    priority: {
                        type: "array",
                        items: { type: "string" },
                        description: "Priority levels to show"
                    }
                }
            },
            viewMode: {
                type: "string",
                enum: ["list", "grid", "calendar", "timeline"],
                description: "How to display the data"
            }
        }
    },
    execute: async ({ dateRange, groupBy, filters = {}, viewMode }) => {
        // Update your UI state management
        const updates = {};
        
        if (dateRange) {
            updates.dateRange = parseDateRange(dateRange);
        }
        if (groupBy) {
            updates.groupBy = groupBy;
        }
        if (viewMode) {
            updates.viewMode = viewMode;
        }
        if (Object.keys(filters).length > 0) {
            updates.filters = { ...window.dashboardUI.currentFilters, ...filters };
        }
        
        // Apply all updates atomically
        window.dashboardUI.setState(updates);
        
        // Trigger data refresh
        await window.dashboardUI.refreshData();
        
        return {
            applied: updates,
            currentView: window.dashboardUI.getCurrentViewDescription(),
            recordCount: window.dashboardUI.getVisibleRecordCount()
        };
    }
});
```

**Best Practices:**
- Accept enums for UI states
- Combine multiple UI changes atomically
- Return human-readable description of current view
- Include metrics (record count, etc.)

---

## Advanced Capabilities

### Dynamic Tool Registration

Register tools based on current page state or user permissions:

```javascript
function registerToolsForCurrentUser(user) {
    // Base tools available to all users
    navigator.modelContext.registerTool({
        name: "get-profile",
        description: "Get current user's profile",
        inputSchema: { type: "object", properties: {} },
        execute: async () => user
    });
    
    // Admin-only tools
    if (user.role === 'admin') {
        navigator.modelContext.registerTool({
            name: "moderate-content",
            description: "Review and moderate user-generated content",
            inputSchema: {
                type: "object",
                properties: {
                    action: { 
                        type: "string", 
                        enum: ["approve", "reject", "flag"]
                    },
                    contentId: { type: "string" }
                },
                required: ["action", "contentId"]
            },
            execute: async ({ action, contentId }) => {
                // Admin-only moderation logic
            }
        });
    }
    
    // Page-specific tools
    if (window.location.pathname.startsWith('/dashboard')) {
        registerDashboardTools();
    }
}
```

### Tool Lifecycle Management

Unregister tools when no longer needed:

```javascript
class TaskEditor {
    constructor() {
        this.toolRegistration = null;
    }
    
    open(taskId) {
        // Register tools specific to this task
        this.toolRegistration = navigator.modelContext.registerTool({
            name: `edit-task-${taskId}`,
            description: `Edit task ${taskId}`,
            inputSchema: { /* ... */ },
            execute: async (params) => {
                // Only works while editor is open
            }
        });
    }
    
    close() {
        // Clean up when done
        if (this.toolRegistration) {
            navigator.modelContext.unregisterTool(`edit-task-${taskId}`);
            this.toolRegistration = null;
        }
    }
}
```

### Context-Aware Tool Schemas

Include dynamic context in tool responses:

```javascript
navigator.modelContext.registerTool({
    name: "analyze-data",
    description: "Analyze the currently visible dataset",
    inputSchema: {
        type: "object",
        properties: {
            analysisType: {
                type: "string",
                enum: ["summary", "trends", "anomalies", "correlations"],
                description: "Type of analysis to perform"
            }
        }
    },
    execute: async ({ analysisType }) => {
        // Get current view context
        const currentView = window.dashboardUI.getCurrentView();
        const visibleData = currentView.getVisibleData();
        
        // Provide context about what's being analyzed
        const context = {
            dataset: currentView.datasetName,
            recordCount: visibleData.length,
            dateRange: currentView.dateRange,
            filters: currentView.activeFilters
        };
        
        // Perform analysis
        const results = await performAnalysis(analysisType, visibleData);
        
        return {
            context,
            analysis: results,
            interpretation: generateInterpretation(results, context)
        };
    }
});
```

---

## Security Best Practices

### Input Validation

Always validate tool inputs, even with JSON Schema:

```javascript
navigator.modelContext.registerTool({
    name: "delete-document",
    description: "Delete a document by ID",
    inputSchema: {
        type: "object",
        properties: {
            documentId: { 
                type: "string", 
                pattern: "^[a-zA-Z0-9_-]{10,50}$"
            },
            confirmDelete: { type: "boolean" }
        },
        required: ["documentId"]
    },
    execute: async ({ documentId, confirmDelete }, agent) => {
        // Additional server-side validation
        const doc = await fetchDocument(documentId);
        if (!doc) {
            throw new Error("Document not found or access denied");
        }
        
        // Check permissions
        if (!canDelete(doc, window.currentUser)) {
            throw new Error("Permission denied");
        }
        
        // Require explicit confirmation for destructive actions
        if (!confirmDelete) {
            return {
                requiresConfirmation: true,
                document: { id: doc.id, title: doc.title },
                message: "Set confirmDelete: true to proceed"
            };
        }
        
        // Soft delete instead of hard delete
        await softDeleteDocument(documentId, window.currentUser.id);
        
        return { deleted: true, documentId, deletedAt: new Date().toISOString() };
    }
});
```

### User Confirmation for Sensitive Actions

```javascript
async function executeSensitiveTool(params, agent) {
    // Always confirm high-impact operations
    const confirmed = await agent.requestUserInteraction(async () => {
        // Show a rich confirmation dialog
        const dialog = document.createElement('confirmation-dialog');
        dialog.action = params.action;
        dialog.impact = calculateImpact(params);
        
        document.body.appendChild(dialog);
        
        return new Promise((resolve) => {
            dialog.addEventListener('confirmed', () => resolve(true));
            dialog.addEventListener('cancelled', () => resolve(false));
        });
    });
    
    if (!confirmed) {
        throw new Error("Operation cancelled by user");
    }
    
    // Proceed with operation
}
```

### Rate Limiting & Abuse Prevention

```javascript
class ToolRateLimiter {
    constructor(maxCalls = 10, windowMs = 60000) {
        this.calls = [];
        this.maxCalls = maxCalls;
        this.windowMs = windowMs;
    }
    
    canExecute() {
        const now = Date.now();
        // Remove old calls outside the window
        this.calls = this.calls.filter(time => now - time < this.windowMs);
        return this.calls.length < this.maxCalls;
    }
    
    recordCall() {
        this.calls.push(Date.now());
    }
}

// Use in tool implementation
const limiter = new ToolRateLimiter(10, 60000);

navigator.modelContext.registerTool({
    name: "expensive-operation",
    description: "Perform an expensive API call",
    inputSchema: { /* ... */ },
    execute: async (params) => {
        if (!limiter.canExecute()) {
            throw new Error("Rate limit exceeded. Try again in a minute.");
        }
        
        limiter.recordCall();
        return await performExpensiveOperation(params);
    }
});
```

---

## Integration Patterns

### React Integration

```jsx
import { useEffect, useCallback } from 'react';

function useWebMCPTool(toolDefinition, dependencies = []) {
    useEffect(() => {
        if (!('modelContext' in navigator)) return;
        
        const registration = navigator.modelContext.registerTool(toolDefinition);
        
        return () => {
            registration.unregister();
        };
    }, dependencies);
}

// Usage in component
function ShoppingCart() {
    const [items, setItems] = useState([]);
    
    useWebMCPTool({
        name: "get-cart",
        description: "Get current cart contents",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ items })
    }, [items]);
    
    useWebMCPTool({
        name: "add-item",
        description: "Add item to cart",
        inputSchema: {
            type: "object",
            properties: {
                productId: { type: "string" },
                quantity: { type: "number" }
            }
        },
        execute: async ({ productId, quantity }) => {
            setItems(prev => [...prev, { productId, quantity }]);
            return { success: true };
        }
    }, []);
    
    return <div>{/* cart UI */}</div>;
}
```

### Vue Integration

```javascript
// composables/useWebMCP.js
import { onMounted, onUnmounted } from 'vue';

export function useWebMCPTool(toolDefinition) {
    let registration = null;
    
    onMounted(() => {
        if ('modelContext' in navigator) {
            registration = navigator.modelContext.registerTool(toolDefinition);
        }
    });
    
    onUnmounted(() => {
        if (registration) {
            registration.unregister();
        }
    });
}

// Usage in component
export default {
    setup() {
        const cart = ref([]);
        
        useWebMCPTool({
            name: 'get-cart',
            description: 'Get cart contents',
            inputSchema: { type: 'object', properties: {} },
            execute: () => ({ items: cart.value })
        });
        
        return { cart };
    }
};
```

### State Management Integration

```javascript
// Redux middleware
const webMCPMiddleware = store => {
    if (!('modelContext' in navigator)) return next => action => next(action);
    
    // Register tools based on store state
    navigator.modelContext.registerTool({
        name: "get-state",
        description: "Get current application state",
        inputSchema: { 
            type: "object",
            properties: {
                slice: { 
                    type: "string",
                    description: "Optional state slice to retrieve"
                }
            }
        },
        execute: ({ slice }) => {
            const state = store.getState();
            return slice ? state[slice] : state;
        }
    });
    
    return next => action => next(action);
};

// Zustand integration
const useStore = create((set, get) => ({
    items: [],
    addItem: (item) => set(state => ({ items: [...state.items, item] })),
    
    // Expose to WebMCP
    registerMCPTools: () => {
        if (!('modelContext' in navigator)) return;
        
        navigator.modelContext.registerTool({
            name: "add-to-store",
            description: "Add item to store",
            inputSchema: { /* ... */ },
            execute: ({ item }) => {
                get().addItem(item);
                return { success: true };
            }
        });
    }
}));
```

---

## Testing & Validation

### Unit Testing Tools

```javascript
// test-tools.js
describe('WebMCP Tools', () => {
    beforeEach(() => {
        // Clear registered tools
        // (Implementation depends on your setup)
    });
    
    test('cart tool returns correct data', async () => {
        // Setup
        const mockCart = { items: [{ id: 1, name: 'Test' }] };
        window.cartStore = { getState: () => mockCart };
        
        // Register tool
        navigator.modelContext.registerTool({
            name: "test-get-cart",
            description: "Test cart",
            inputSchema: { type: "object", properties: {} },
            execute: async () => window.cartStore.getState()
        });
        
        // Execute
        const result = await executeTool("test-get-cart", {});
        
        // Assert
        expect(result.items).toHaveLength(1);
        expect(result.items[0].name).toBe('Test');
    });
});
```

### Manual Testing with Browser Console

```javascript
// Test your tools in browser DevTools
async function testTool(toolName, params = {}) {
    // This assumes you have a way to invoke tools for testing
    // Actual implementation depends on your testing setup
    console.log(`Testing ${toolName} with:`, params);
    
    try {
        const result = await window.testMCPClient.callTool(toolName, params);
        console.log('Result:', result);
        return result;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

// Usage:
// testTool('get-cart', {})
// testTool('add-to-cart', { productId: '123', quantity: 2 })
```

### Schema Validation

```javascript
// Validate your schemas
const Ajv = require('ajv');
const ajv = new Ajv();

function validateToolSchema(tool) {
    // Validate inputSchema is valid JSON Schema
    try {
        ajv.compile(tool.inputSchema);
    } catch (error) {
        console.error(`Invalid schema for tool ${tool.name}:`, error);
        return false;
    }
    
    // Validate required fields
    const required = ['name', 'description', 'inputSchema', 'execute'];
    for (const field of required) {
        if (!(field in tool)) {
            console.error(`Tool ${tool.name} missing required field: ${field}`);
            return false;
        }
    }
    
    return true;
}
```

---

## Real-World Examples

### Example 1: E-Commerce Product Discovery

```javascript
// Complete e-commerce MCP setup
function initializeEcommerceMCP() {
    if (!('modelContext' in navigator)) return;
    
    // Product discovery
    navigator.modelContext.registerTool({
        name: "find-products",
        description: "Find products matching natural language criteria",
        inputSchema: {
            type: "object",
            properties: {
                criteria: { 
                    type: "string",
                    description: "What you're looking for (e.g., 'red running shoes under $100')"
                }
            },
            required: ["criteria"]
        },
        execute: async ({ criteria }) => {
            const results = await semanticSearch(criteria);
            window.productGrid.display(results);
            return { found: results.length, products: results.slice(0, 5) };
        }
    });
    
    // Cart management
    navigator.modelContext.registerTool({
        name: "manage-cart",
        description: "View or modify shopping cart",
        inputSchema: {
            type: "object",
            properties: {
                action: { 
                    type: "string", 
                    enum: ["view", "add", "remove", "clear"]
                },
                productId: { type: "string" },
                quantity: { type: "number" }
            },
            required: ["action"]
        },
        execute: async ({ action, productId, quantity }, agent) => {
            switch (action) {
                case "view":
                    return window.cartStore.getState();
                case "add":
                    if (!productId) throw new Error("productId required");
                    window.cartStore.add({ productId, quantity: quantity || 1 });
                    return { added: true };
                // ... etc
            }
        }
    });
    
    // Checkout assistance
    navigator.modelContext.registerTool({
        name: "assist-checkout",
        description: "Help user complete purchase",
        inputSchema: {
            type: "object",
            properties: {
                step: {
                    type: "string",
                    enum: ["review-cart", "select-shipping", "apply-coupon", "place-order"]
                }
            }
        },
        execute: async ({ step }, agent) => {
            // Guide user through checkout with confirmations
        }
    });
}
```

### Example 2: Developer Tools Integration

```javascript
// Code review platform MCP
function initializeCodeReviewMCP() {
    navigator.modelContext.registerTool({
        name: "analyze-pr",
        description: "Get comprehensive analysis of a pull request",
        inputSchema: {
            type: "object",
            properties: {
                prNumber: { type: "number" },
                focus: {
                    type: "array",
                    items: { 
                        type: "string",
                        enum: ["security", "performance", "maintainability", "tests"]
                    }
                }
            },
            required: ["prNumber"]
        },
        execute: async ({ prNumber, focus = [] }) => {
            const pr = await fetchPR(prNumber);
            const analysis = await analyzeCode(pr.diff, focus);
            
            return {
                summary: analysis.summary,
                issues: analysis.issues,
                suggestions: analysis.suggestions,
                stats: {
                    filesChanged: pr.filesChanged,
                    linesAdded: pr.additions,
                    linesRemoved: pr.deletions
                }
            };
        }
    });
    
    navigator.modelContext.registerTool({
        name: "suggest-fix",
        description: "Generate a suggested fix for an issue",
        inputSchema: {
            type: "object",
            properties: {
                issueId: { type: "string" },
                filePath: { type: "string" },
                lineNumber: { type: "number" }
            },
            required: ["issueId", "filePath"]
        },
        execute: async ({ issueId, filePath, lineNumber }) => {
            const context = await getCodeContext(filePath, lineNumber);
            const fix = await generateFix(context, issueId);
            
            return {
                suggestion: fix.code,
                explanation: fix.explanation,
                confidence: fix.confidence
            };
        }
    });
}
```

### Example 3: Content Management System

```javascript
// CMS MCP for content editors
function initializeCMSMCP() {
    navigator.modelContext.registerTool({
        name: "content-operations",
        description: "Perform content management operations",
        inputSchema: {
            type: "object",
            properties: {
                operation: {
                    type: "string",
                    enum: ["create", "edit", "publish", "schedule", "archive"]
                },
                contentType: { 
                    type: "string",
                    enum: ["article", "page", "media", "product"]
                },
                contentId: { type: "string" },
                data: { type: "object" }
            },
            required: ["operation", "contentType"]
        },
        execute: async ({ operation, contentType, contentId, data }, agent) => {
            // Verify permissions
            if (!hasPermission(window.currentUser, operation, contentType)) {
                throw new Error("Permission denied");
            }
            
            // Confirm destructive operations
            if (['publish', 'archive'].includes(operation)) {
                const confirmed = await agent.requestUserInteraction(async () => {
                    return confirm(`${operation} ${contentType}? This will be visible to users.`);
                });
                if (!confirmed) throw new Error("Cancelled by user");
            }
            
            // Execute operation
            const result = await cmsAPI[operation](contentType, contentId, data);
            return { success: true, contentId: result.id, url: result.url };
        }
    });
    
    navigator.modelContext.registerTool({
        name: "search-content",
        description: "Search across all content with semantic understanding",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string" },
                filters: {
                    type: "object",
                    properties: {
                        type: { type: "array", items: { type: "string" } },
                        status: { type: "array", items: { type: "string" } },
                        author: { type: "string" },
                        dateRange: { type: "string" }
                    }
                }
            }
        },
        execute: async ({ query, filters }) => {
            const results = await semanticContentSearch(query, filters);
            return {
                results: results.map(r => ({
                    id: r.id,
                    title: r.title,
                    excerpt: r.excerpt,
                    type: r.contentType,
                    relevance: r.score
                })),
                total: results.total
            };
        }
    });
}
```

---

## Decision Matrix

### When to Use Each Pattern

| Scenario | Recommended Pattern | Key Considerations |
|----------|-------------------|-------------------|
| **Read-only data** | Pattern 1: Query Tools | Fast, cacheable, safe |
| **User actions** | Pattern 2: State Modification | Reuse existing logic, update UI |
| **Search/Filter** | Pattern 3: Navigation Tools | Natural language input, rich results |
| **Complex workflows** | Pattern 4: Multi-Step Tools | Confirm at each stage, provide rollback |
| **UI control** | Pattern 5: UI Manipulation | Accept enums, combine changes atomically |

### Security Checklist

- [ ] Input validation (schema + runtime)
- [ ] Permission checks before operations
- [ ] User confirmation for destructive actions
- [ ] Rate limiting for expensive operations
- [ ] Audit logging for sensitive tools
- [ ] No exposure of internal IDs/secrets
- [ ] Sanitization of tool descriptions
- [ ] Review for prompt injection vectors

---

## Resources

### Official Documentation
- W3C WebMCP Explainer: https://github.com/webmachinelearning/webmcp
- Microsoft Edge Explainer: https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebModelContext/explainer.md

### Related Specifications
- Model Context Protocol: https://modelcontextprotocol.io
- JSON Schema: https://json-schema.org

### Tools
- JSON Schema Validator: https://www.jsonschemavalidator.net
- JSON Schema Generator: Various tools available

---

**Document Version:** 1.0  
**Last Updated:** 2025-02-10  
**Specification Status:** W3C CG-DRAFT (subject to change)
