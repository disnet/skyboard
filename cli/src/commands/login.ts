import { login } from "../lib/auth.js";
import chalk from "chalk";

export async function loginCommand(handle: string): Promise<void> {
  try {
    console.log(`Logging in as ${chalk.bold(handle)}...`);
    const { did, handle: resolvedHandle } = await login(handle);
    console.log(chalk.green(`Logged in as ${resolvedHandle} (${did})`));
  } catch (err) {
    console.error(chalk.red(`Login failed: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}
