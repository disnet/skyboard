#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { statusCommand } from "./commands/status.js";
import { boardsCommand } from "./commands/boards.js";
import { useCommand } from "./commands/use.js";
import { addCommand } from "./commands/add.js";
import { colsCommand } from "./commands/cols.js";
import { cardsCommand } from "./commands/cards.js";
import { showCommand } from "./commands/show.js";
import { newCommand } from "./commands/new.js";
import { mvCommand } from "./commands/mv.js";
import { editCommand } from "./commands/edit.js";
import { commentCommand } from "./commands/comment.js";
import { rmCommand } from "./commands/rm.js";

const program = new Command();

program
  .name("sb")
  .description("Skyboard CLI — manage kanban boards on AT Protocol")
  .version(
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf-8",
      ),
    ).version,
  );

// Auth commands
program
  .command("login")
  .description("Log in via AT Protocol OAuth (opens browser)")
  .argument("<handle>", "Your AT Protocol handle (e.g. alice.bsky.social)")
  .action(loginCommand);

program
  .command("logout")
  .description("Log out and clear stored session")
  .action(logoutCommand);

program
  .command("whoami")
  .description("Show current authenticated user")
  .option("--json", "Output as JSON")
  .action(whoamiCommand);

program
  .command("status")
  .description("Show current auth state and board summary")
  .option("--json", "Output as JSON")
  .action(statusCommand);

// Board navigation
program
  .command("boards")
  .description("List all boards (owned + joined)")
  .option("--json", "Output as JSON")
  .action(boardsCommand);

program
  .command("use")
  .description("Set default board for subsequent commands")
  .argument("<board>", "Board name, rkey, AT URI, or web URL")
  .action(useCommand);

program
  .command("add")
  .description("Join a board by AT URI or web URL")
  .argument("<link>", "AT URI or web URL of the board")
  .action(addCommand);

program
  .command("cols")
  .description("Show columns for the current board")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(colsCommand);

// Card operations
program
  .command("cards")
  .description("List cards grouped by column")
  .option("-c, --column <column>", "Filter by column (name, prefix, or number)")
  .option("-l, --label <label>", "Filter by label name")
  .option("-s, --search <text>", "Search in title and description")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(cardsCommand);

program
  .command("new")
  .description("Create a new card")
  .argument("<title>", "Card title")
  .option("-c, --column <column>", "Target column (default: first column)")
  .option("-d, --description <desc>", "Card description")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(newCommand);

program
  .command("show")
  .description("Show card details, comments, and history")
  .argument("<ref>", "Card reference (rkey prefix, min 4 chars)")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(showCommand);

program
  .command("mv")
  .description("Move a card to a different column")
  .argument("<ref>", "Card reference (rkey prefix)")
  .argument("<column>", "Target column (name, prefix, or number)")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(mvCommand);

program
  .command("edit")
  .description("Edit card fields")
  .argument("<ref>", "Card reference (rkey prefix)")
  .option("-t, --title <title>", "New title")
  .option("-d, --description <desc>", "New description")
  .option("-l, --label <label...>", "Set labels (by name)")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(editCommand);

program
  .command("comment")
  .description("Add a comment to a card")
  .argument("<ref>", "Card reference (rkey prefix)")
  .argument("<text>", "Comment text")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(commentCommand);

program
  .command("rm")
  .description("Delete a card (owner only)")
  .argument("<ref>", "Card reference (rkey prefix)")
  .option("-f, --force", "Skip confirmation")
  .option("--board <ref>", "Override default board")
  .option("--json", "Output as JSON")
  .action(rmCommand);

program.parse();
