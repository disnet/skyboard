import { readFileSync, writeFileSync } from "node:fs";
import type { RalphConfig, WorkflowType } from "./config.js";

interface ColumnDef {
  name: string;
  description: string;
}

const SIMPLE_COLUMNS: ColumnDef[] = [
  { name: "Backlog", description: "Raw ideas or requests. Not yet scoped." },
  { name: "In Progress", description: "Actively being worked on." },
  { name: "Done", description: "Verified and complete." },
];

const STANDARD_COLUMNS: ColumnDef[] = [
  { name: "Backlog", description: "Raw ideas or requests. Not yet scoped." },
  { name: "Planned", description: "Scoped and ready to implement. Has clear acceptance criteria." },
  { name: "In Progress", description: "Actively being worked on." },
  { name: "In Review", description: "Implementation complete, needs verification (tests pass, code review)." },
  { name: "Done", description: "Verified and complete." },
];

function getColumns(config: RalphConfig): ColumnDef[] {
  if (config.workflow === "simple") return SIMPLE_COLUMNS;
  if (config.workflow === "custom" && config.columns) {
    return config.columns.map((name) => ({ name, description: "" }));
  }
  return STANDARD_COLUMNS;
}

function buildColumnsSection(columns: ColumnDef[]): string {
  return columns
    .map((col, i) => {
      const desc = col.description ? ` — ${col.description}` : "";
      return `${i + 1}. **${col.name}**${desc}`;
    })
    .join("\n");
}

function buildTransitionTable(columns: ColumnDef[]): string {
  const rows: string[] = [];
  rows.push("| Transition | What to do | Move when |");
  rows.push("|---|---|---|");

  for (let i = 0; i < columns.length - 1; i++) {
    const from = columns[i].name;
    const to = columns[i + 1].name;
    const { what, when } = transitionDetails(from, to);
    rows.push(`| ${from} → ${to} | ${what} | ${when} |`);
  }

  return rows.join("\n");
}

function transitionDetails(from: string, to: string): { what: string; when: string } {
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();

  if (fromLower === "backlog" && toLower === "planned") {
    return {
      what: "Read the card. Break down the work. Add a comment with implementation approach and acceptance criteria.",
      when: "Scope is clear and actionable",
    };
  }
  if (fromLower === "backlog" && toLower === "in progress") {
    return {
      what: "Read the card. Break down the work if needed, then start coding.",
      when: "Meaningful code has been written",
    };
  }
  if (fromLower === "planned" && toLower === "in progress") {
    return {
      what: "Start coding. Write the implementation.",
      when: "Meaningful code has been written",
    };
  }
  if (fromLower === "in progress" && toLower === "in review") {
    return {
      what: "Finish the implementation. Run tests.",
      when: "Code is complete and tests pass",
    };
  }
  if (fromLower === "in progress" && toLower === "done") {
    return {
      what: "Finish the implementation. Run tests. Review code quality.",
      when: "Code is complete and tests pass",
    };
  }
  if (fromLower === "in review" && toLower === "done") {
    return {
      what: "Review code quality. Verify tests. Check acceptance criteria from earlier comments.",
      when: "Everything checks out",
    };
  }

  // Generic fallback for custom columns
  return {
    what: `Complete the work needed for the ${to} stage.`,
    when: `Ready for ${to}`,
  };
}

function buildPickPriority(columns: ColumnDef[]): string {
  // Reverse order (excluding Done), highest priority first
  const workColumns = columns.filter((c) => c.name.toLowerCase() !== "done").reverse();
  return workColumns
    .map((col, i) => {
      if (i === workColumns.length - 1) {
        return `- **${col.name}** cards last — scope and plan the work`;
      }
      if (i === 0) {
        return `- **${col.name}** cards first — verify the work, run tests, check quality`;
      }
      return `- **${col.name}** cards — continue implementation`;
    })
    .join("\n");
}

function buildBranchingRule(branching: string): string {
  if (branching === "current-branch") {
    return `- **Branching:** Do not create new branches. Commit directly to the current branch.`;
  }
  return `- **Branching:** Always create or checkout a dedicated branch for the card you are working on before making any code changes. The branch name must be \`card/<rkey>\` where \`<rkey>\` is the card's record key (e.g., \`card/3lgjasx2zws2p\`). If the branch already exists, check it out and continue from there.`;
}

function buildDefaultProtocol(config: RalphConfig): string {
  const columns = getColumns(config);

  return `# Skyboard Loop Agent

This project uses a Skyboard kanban board to drive an iterative development loop. Each invocation checks the board, picks a task, does one unit of work, updates the board, and writes a status file before exiting.

## Board

- Board DID: \`{{boardDid}}\`
- Board rkey: \`{{boardRkey}}\`
- Set with: \`sb use {{boardRkey}}\`

## Columns (workflow stages)

${buildColumnsSection(columns)}

## Agent Protocol (one invocation = one transition)

This is iteration {{iteration}} of {{maxIterations}}.

Each invocation of the loop, follow this protocol:

### 1. ASSESS

Run \`sb cards --json\` to see the full board state. Identify which cards are in which columns and which have the \`blocked\` label.

### 2. PICK

Select one card to work on using this priority order:

${buildPickPriority(columns)}

**Skip cards with the \`blocked\` label.** These are waiting on human input. However, if a previously-blocked card has a new comment from the human since it was blocked, the human has likely answered — remove the \`blocked\` label (\`sb edit <ref> -l ""\`) and work on it.

Within a column, pick the topmost (first listed) non-blocked card. Use \`sb show <ref> --json\` to read the card's full details and comments before starting.

### 3. DO one transition

Each transition type has a specific definition of done:

${buildTransitionTable(columns)}

**Never skip columns.** A card must pass through each stage in order.

**Moving backwards:** If verification fails during a review stage, move the card back to the previous stage with a comment explaining what failed.

### 4. UPDATE

After doing the work:

1. Add a comment to the card describing what you did: \`sb comment <ref> "<summary>"\`
2. Move the card: \`sb mv <ref> <column>\`

### 5. WRITE STATUS AND EXIT

After completing one transition (or determining you can't make progress), write a status file and stop.

**After a successful transition:**

\`\`\`bash
echo "CONTINUE" > .skyboard-ralph/loop-status
\`\`\`

**If blocked on a card:**

1. Comment on the card explaining what's blocking you
2. Add the \`blocked\` label: \`sb edit <ref> -l blocked\`
3. Do NOT move the card
4. Try to pick a different non-blocked card instead
5. If no other non-blocked cards are available:

\`\`\`bash
echo "BLOCKED" > .skyboard-ralph/loop-status
\`\`\`

**If all done** (every card is in Done and Backlog is empty):

\`\`\`bash
echo "DONE" > .skyboard-ralph/loop-status
\`\`\`

**If all remaining cards are blocked** (every non-Done card has the \`blocked\` label):

\`\`\`bash
echo "BLOCKED" > .skyboard-ralph/loop-status
\`\`\`

You MUST write to \`.skyboard-ralph/loop-status\` before exiting. The outer loop script reads this file to decide whether to continue.

## Rules

- One card, one transition per invocation. Do not work on multiple cards.
- Always read the card details (\`sb show\`) before starting work.
- Always comment before moving. The comment trail is how the human tracks progress.
- Check for new comments from the human — they may have added guidance or reprioritized.
- If a card's description is vague, comment asking for clarification and move on to the next card.
${buildBranchingRule(config.branching)}
- **Never push.** Do not run \`git push\` under any circumstances. The human will handle pushing.
- Commit code changes with clear commit messages before ending the iteration.
- Always write \`.skyboard-ralph/loop-status\` as your very last action.
`;
}

export function writeDefaultProtocol(path: string, config?: RalphConfig): void {
  const defaultConfig: RalphConfig = config ?? {
    board: { did: "{{boardDid}}", rkey: "{{boardRkey}}" },
    maxIterations: 50,
    workflow: "standard",
    branching: "per-card",
    statusFile: ".skyboard-ralph/loop-status",
    logFile: ".skyboard-ralph/loop.log",
    protocolFile: ".skyboard-ralph/protocol.md",
  };
  writeFileSync(path, buildDefaultProtocol(defaultConfig));
}

export function generateProtocol(
  protocolFile: string,
  context: {
    iteration: number;
    maxIterations: number;
    boardDid: string;
    boardRkey: string;
  },
): string {
  let content = readFileSync(protocolFile, "utf-8");
  content = content.replace(/\{\{iteration\}\}/g, String(context.iteration));
  content = content.replace(/\{\{maxIterations\}\}/g, String(context.maxIterations));
  content = content.replace(/\{\{boardDid\}\}/g, context.boardDid);
  content = content.replace(/\{\{boardRkey\}\}/g, context.boardRkey);
  return content;
}
