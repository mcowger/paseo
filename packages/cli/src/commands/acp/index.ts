import { Command } from "commander";
import { runAntigravityAcpAdapter } from "./antigravity.js";

export function createAcpCommand(): Command {
  const command = new Command("acp").description("Run local ACP adapter commands");

  command
    .command("antigravity")
    .description("Run an ACP adapter for the installed agy CLI")
    .action(() => {
      runAntigravityAcpAdapter();
    });

  return command;
}
