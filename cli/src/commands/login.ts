import { login } from "../lib/auth.js";
import { loadAuthInfo, clearDefaultBoard } from "../lib/config.js";
import chalk from "chalk";

export async function loginCommand(handle: string): Promise<void> {
  const previousAuth = loadAuthInfo();
  try {
    console.log(`Logging in as ${chalk.bold(handle)}...`);
    const { did, handle: resolvedHandle } = await login(handle);
    // Clear board selection when switching accounts
    if (previousAuth && previousAuth.did !== did) {
      clearDefaultBoard();
    }
    console.log(chalk.green(`Logged in as ${resolvedHandle} (${did})`));
  } catch (err) {
    console.error(chalk.red(`Login failed: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}
