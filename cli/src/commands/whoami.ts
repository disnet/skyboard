import { loadAuthInfo } from "../lib/config.js";
import chalk from "chalk";

export function whoamiCommand(opts: { json?: boolean }): void {
  const info = loadAuthInfo();
  if (!info) {
    if (opts.json) {
      console.log(JSON.stringify({ loggedIn: false }));
    } else {
      console.log("Not logged in. Run `sb login <handle>` first.");
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ loggedIn: true, ...info }, null, 2));
  } else {
    console.log(`${chalk.bold("Handle:")}  ${info.handle}`);
    console.log(`${chalk.bold("DID:")}     ${info.did}`);
    console.log(`${chalk.bold("PDS:")}     ${info.service}`);
  }
}
