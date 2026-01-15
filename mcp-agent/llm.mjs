import { execSync } from "child_process";

export function callLLM(prompt) {
  return execSync(
    `ollama run llama3 "${prompt.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" }
  ).trim();
}
