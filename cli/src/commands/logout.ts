import { logout } from "../lib/auth.js";
import { loadAuthInfo, clearDefaultBoard } from "../lib/config.js";
import chalk from "chalk";

export function logoutCommand(): void {
  const info = loadAuthInfo();
  if (!info) {
    console.log("Not logged in.");
    return;
  }
  logout();
  clearDefaultBoard();
  console.log(chalk.green(`Logged out (was ${info.handle}).`));
}
