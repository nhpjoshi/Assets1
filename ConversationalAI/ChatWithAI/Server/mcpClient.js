import { spawn } from "child_process";
import readline from "readline";

export class MCPClient {
  constructor(command, args) {
    this.proc = spawn(command, args);
    this.rl = readline.createInterface({
      input: this.proc.stdout,
    });
  }

  send(msg) {
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  request(method, params) {
    const id = Math.random().toString(36).slice(2);

    this.send({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return new Promise((resolve) => {
      const handler = (line) => {
        const res = JSON.parse(line);
        if (res.id === id) {
          this.rl.removeListener("line", handler);
          resolve(res.result);
        }
      };
      this.rl.on("line", handler);
    });
  }

  listTools() {
    return this.request("tools/list", {});
  }

  callTool(name, args) {
    return this.request("tools/call", {
      name,
      arguments: args,
    });
  }
}
