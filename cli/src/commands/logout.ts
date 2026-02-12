import { logout } from "../lib/auth.js";
import { loadAuthInfo } from "../lib/config.js";
import chalk from "chalk";

export function logoutCommand(): void {
  const info = loadAuthInfo();
  if (!info) {
    console.log("Not logged in.");
    return;
  }
  logout();
  console.log(chalk.green(`Logged out (was ${info.handle}).`));
}
