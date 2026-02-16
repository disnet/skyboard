# Skyboard Loop Agent

This project uses a Skyboard kanban board to drive an iterative development loop. Each invocation performs exactly one card transition: check the board, pick one card, advance it to the next column, and exit.

## Board

- Board DID: `{{boardDid}}`
- Board rkey: `{{boardRkey}}`
- Set with: `sb use {{boardRkey}}`

## Columns (workflow stages)

1. **Backlog** — Raw ideas or requests. Not yet scoped.
2. **Planned** — Scoped and ready to implement. Has clear acceptance criteria. **Human-gated: the agent never picks cards from Planned.** The human reviews the plan and moves approved cards to In Progress (or back to Backlog with comments if changes are needed).
3. **In Progress** — Actively being worked on.
4. **In Review** — Implementation complete, needs verification (tests pass, code review). **Human-only stage: the agent never moves cards out of In Review.**
5. **Done** — Verified and complete. Only the human moves cards here after review.

## Agent Protocol (one invocation = one transition)

This is iteration {{iteration}} of {{maxIterations}}.

Each invocation of the loop, follow this protocol:

### 1. ASSESS

Run `sb cards --json` to see the full board state. Identify which cards are in which columns and which have the `blocked` label.

### 2. PICK

Select exactly one card to work on. You will only work on this single card during this invocation. Use this priority order:

- **In Progress** cards first — continue implementation
- **Backlog** cards last — scope and plan the work

**Never pick cards from Planned.** Planned is a human gate. The human reviews the agent's plan and moves approved cards to In Progress. The agent only sees In Progress cards once the human has approved them.

**Skip cards with the `blocked` label.** These are waiting on human input. However, if a previously-blocked card has a new comment from the human since it was blocked, the human has likely answered — remove the `blocked` label (`sb edit <ref> -l ""`) and work on it.

Within a column, pick the topmost (first listed) non-blocked card. Use `sb show <ref> --json` to read the card's full details and comments before starting.

### 3. DO one transition

Each transition type has a specific definition of done:

| Transition | What to do | Move when |
|---|---|---|
| Backlog → Planned | Read the card. Investigate the codebase to understand the scope. Update the card description (`sb edit <ref> -d "..."`) with a clear summary of the work, implementation approach, and acceptance criteria. Add a comment summarizing your findings. | Scope is clear and actionable |
| In Progress → In Review | Start coding based on the accepted plan. Write the implementation. Run tests. Create a PR with `gh pr create`. | Code is complete, tests pass, and PR is created |

**Note:** There is no Planned → In Progress transition for the agent. The human moves approved cards from Planned to In Progress.

**Never skip columns.** A card must pass through each stage in order.

**Moving backwards:** If verification fails during a review stage, move the card back to the previous stage with a comment explaining what failed.

**IMPORTANT: After completing one transition, proceed immediately to UPDATE (step 4) and then WRITE STATUS AND EXIT (step 5). Do not pick another card or perform additional transitions.**

### 4. UPDATE

After doing the work:

1. Add a comment to the card describing what you did: `sb comment <ref> "<summary>"`
2. Move the card: `sb mv <ref> <column>`

### 5. WRITE STATUS AND EXIT

After completing one transition (or determining you can't make progress), write a status file and stop.

**After a successful transition:**

```bash
echo "CONTINUE" > .skyboard-ralph/loop-status
```

**If blocked on a card:**

1. Comment on the card explaining what's blocking you
2. Add the `blocked` label: `sb edit <ref> -l blocked`
3. Do NOT move the card
4. Try to pick a different non-blocked card instead
5. If no other non-blocked cards are available:

```bash
echo "BLOCKED" > .skyboard-ralph/loop-status
```

**If all done** (every card is in Planned, In Review, or Done and Backlog and In Progress are empty):

```bash
echo "DONE" > .skyboard-ralph/loop-status
```

**If all remaining cards are blocked** (every non-Done card has the `blocked` label):

```bash
echo "BLOCKED" > .skyboard-ralph/loop-status
```

You MUST write to `.skyboard-ralph/loop-status` before exiting. The outer loop script reads this file to decide whether to continue.

## Rules

- One card, one transition per invocation. Do not work on multiple cards.
- Always read the card details (`sb show`) before starting work.
- Always comment before moving. The comment trail is how the human tracks progress.
- Check for new comments from the human — they may have added guidance or reprioritized.
- If a card's description is vague, comment asking for clarification and move on to the next card.
- **Branching:** Always create or checkout a dedicated branch for the card you are working on before making any code changes. The branch name must be `card/<rkey>` where `<rkey>` is the card's record key (e.g., `card/3lgjasx2zws2p`). Always fetch first (`git fetch origin`) and branch off of `origin/main` (i.e., `git checkout -b card/<rkey> origin/main`). If the branch already exists, check it out and continue from there.
- Commit code changes with clear commit messages before ending the iteration.
- **Never pick cards from Planned.** Planned is a human gate — the human approves plans and moves cards to In Progress.
- **Never move a card from In Review to Done.** The human handles all review and merging. In Review is the final column the agent can move a card into.
- Always write `.skyboard-ralph/loop-status` as your very last action.
