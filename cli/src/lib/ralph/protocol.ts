import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_PROTOCOL = `# Skyboard Loop Agent

This project uses a Skyboard kanban board to drive an iterative development loop. Each invocation checks the board, picks a task, does one unit of work, updates the board, and writes a status file before exiting.

## Board

- Board DID: \`{{boardDid}}\`
- Board rkey: \`{{boardRkey}}\`
- Set with: \`sb use {{boardRkey}}\`

## Columns (workflow stages)

1. **Backlog** — Raw ideas or requests. Not yet scoped.
2. **Planned** — Scoped and ready to implement. Has clear acceptance criteria.
3. **In Progress** — Actively being worked on.
4. **In Review** — Implementation complete, needs verification (tests pass, code review).
5. **Done** — Verified and complete.

## Agent Protocol (one invocation = one transition)

This is iteration {{iteration}} of {{maxIterations}}.

Each invocation of the loop, follow this protocol:

### 1. ASSESS

Run \`sb cards --json\` to see the full board state. Identify which cards are in which columns and which have the \`blocked\` label.

### 2. PICK

Select one card to work on using this priority order:

- **In Review** cards first — verify the work, run tests, check quality
- **In Progress** cards second — continue implementation
- **Planned** cards third — begin implementation
- **Backlog** cards last — scope and plan the work

**Skip cards with the \`blocked\` label.** These are waiting on human input. However, if a previously-blocked card has a new comment from the human since it was blocked, the human has likely answered — remove the \`blocked\` label (\`sb edit <ref> -l ""\`) and work on it.

Within a column, pick the topmost (first listed) non-blocked card. Use \`sb show <ref> --json\` to read the card's full details and comments before starting.

### 3. DO one transition

Each transition type has a specific definition of done:

| Transition | What to do | Move when |
|---|---|---|
| Backlog → Planned | Read the card. Break down the work. Add a comment with implementation approach and acceptance criteria. | Scope is clear and actionable |
| Planned → In Progress | Start coding. Write the implementation. | Meaningful code has been written |
| In Progress → In Review | Finish the implementation. Run tests. | Code is complete and tests pass |
| In Review → Done | Review code quality. Verify tests. Check acceptance criteria from earlier comments. | Everything checks out |

**Never skip columns.** A card must pass through each stage in order.

**Moving backwards:** If verification fails during In Review, move the card back to In Progress with a comment explaining what failed.

### 4. UPDATE

After doing the work:

1. Add a comment to the card describing what you did: \`sb comment <ref> "<summary>"\`
2. Move the card: \`sb mv <ref> <column>\`

### 5. WRITE STATUS AND EXIT

After completing one transition (or determining you can't make progress), write a status file and stop.

**After a successful transition:**

\`\`\`bash
echo "CONTINUE" > .claude/loop-status
\`\`\`

**If blocked on a card:**

1. Comment on the card explaining what's blocking you
2. Add the \`blocked\` label: \`sb edit <ref> -l blocked\`
3. Do NOT move the card
4. Try to pick a different non-blocked card instead
5. If no other non-blocked cards are available:

\`\`\`bash
echo "BLOCKED" > .claude/loop-status
\`\`\`

**If all done** (every card is in Done and Backlog is empty):

\`\`\`bash
echo "DONE" > .claude/loop-status
\`\`\`

**If all remaining cards are blocked** (every non-Done card has the \`blocked\` label):

\`\`\`bash
echo "BLOCKED" > .claude/loop-status
\`\`\`

You MUST write to \`.claude/loop-status\` before exiting. The outer loop script reads this file to decide whether to continue.

## Rules

- One card, one transition per invocation. Do not work on multiple cards.
- Always read the card details (\`sb show\`) before starting work.
- Always comment before moving. The comment trail is how the human tracks progress.
- Check for new comments from the human — they may have added guidance or reprioritized.
- If a card's description is vague, comment asking for clarification and move on to the next card.
- Commit code changes with clear commit messages before ending the iteration.
- Always write \`.claude/loop-status\` as your very last action.
`;

export function writeDefaultProtocol(path: string): void {
  writeFileSync(path, DEFAULT_PROTOCOL);
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
