import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
} from "@agentclientprotocol/sdk";

interface AntigravitySession {
  cwd: string;
  hasPrompted: boolean;
}

const DEFAULT_MODEL_ID = "default";
const DEFAULT_MODE_ID = "default";

function promptToText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "resource_link") {
        return block.uri;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function runAgyPrompt(input: {
  prompt: string;
  cwd: string;
  continueConversation: boolean;
  signal: AbortSignal;
}): Promise<string> {
  const args = [
    ...(input.continueConversation ? ["--continue"] : []),
    "--print",
    input.prompt,
    "--print-timeout",
    "5m",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("agy", args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        AGY_CLI_DISABLE_AUTO_UPDATE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const abort = () => {
      child.kill("SIGTERM");
    };
    input.signal.addEventListener("abort", abort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      input.signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code, signal) => {
      input.signal.removeEventListener("abort", abort);
      if (input.signal.aborted) {
        resolve("");
        return;
      }
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const details = stderr.trim() || stdout.trim() || `agy exited with ${signal ?? code}`;
      reject(new Error(details));
    });
  });
}

class AntigravityACPAgent implements Agent {
  private readonly sessions = new Map<string, AntigravitySession>();
  private readonly pendingPrompts = new Map<string, AbortController>();

  constructor(private readonly connection: AgentSideConnection) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: "Paseo Antigravity ACP Adapter",
        version: "1.0.0",
      },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: {
          resume: {},
        },
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      cwd: params.cwd,
      hasPrompted: false,
    });
    return this.buildSessionResponse(sessionId);
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.sessions.set(params.sessionId, {
      cwd: params.cwd,
      hasPrompted: true,
    });
    return this.buildSessionState();
  }

  async unstable_resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    this.sessions.set(params.sessionId, {
      cwd: params.cwd,
      hasPrompted: true,
    });
    return this.buildSessionState();
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown Antigravity session: ${params.sessionId}`);
    }

    const prompt = promptToText(params.prompt);
    const abortController = new AbortController();
    this.pendingPrompts.set(params.sessionId, abortController);

    try {
      const text = await runAgyPrompt({
        prompt,
        cwd: session.cwd,
        continueConversation: session.hasPrompted,
        signal: abortController.signal,
      });
      session.hasPrompted = true;
      if (abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      if (text.length > 0) {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
            messageId: randomUUID(),
          },
        });
      }
      return { stopReason: "end_turn" };
    } finally {
      this.pendingPrompts.delete(params.sessionId);
    }
  }

  async authenticate(): Promise<Record<string, never>> {
    return {};
  }

  async cancel(params: { sessionId: string }): Promise<void> {
    this.pendingPrompts.get(params.sessionId)?.abort();
  }

  private buildSessionResponse(sessionId: string): NewSessionResponse {
    return {
      sessionId,
      ...this.buildSessionState(),
    };
  }

  private buildSessionState(): Omit<NewSessionResponse, "sessionId"> {
    return {
      models: {
        currentModelId: DEFAULT_MODEL_ID,
        availableModels: [
          {
            modelId: DEFAULT_MODEL_ID,
            name: "Configured Antigravity model",
            description: "Uses the model currently selected in Antigravity CLI.",
          },
        ],
      },
      modes: {
        currentModeId: DEFAULT_MODE_ID,
        availableModes: [
          {
            id: DEFAULT_MODE_ID,
            name: "Default",
            description: "Use Antigravity CLI's configured permissions and settings.",
          },
        ],
      },
    };
  }
}

export function runAntigravityAcpAdapter(): void {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin);
  const stream = ndJsonStream(input, output);
  const connection = new AgentSideConnection(
    (agentConnection) => new AntigravityACPAgent(agentConnection),
    stream,
  );
  void connection;
}
