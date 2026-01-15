import { spawn } from "child_process";

export class MCPClient {
  constructor(command, args) {
    this.proc = spawn(command, args);
    this.buffer = "";
    this.pending = new Map();

    this.proc.stdout.on("data", (d) => this.#onData(d));
    this.proc.stderr.on("data", (d) =>
      console.error("[MCP STDERR]", d.toString())
    );

    this.proc.on("exit", (code) => {
      console.error("[MCP] process exited with code", code);
    });
  }

  #onData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error("[MCP] Invalid JSON:", line);
        continue;
      }

      const resolve = this.pending.get(msg.id);
      if (resolve) {
        resolve(msg.result);
        this.pending.delete(msg.id);
      }
    }
  }

  #call(method, params = {}) {
    const id = crypto.randomUUID();
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  listTools() {
    return this.#call("tools/list");
  }

  callTool(name, args) {
    return this.#call("tools/call", {
      name,
      arguments: args,
    });
  }
}
