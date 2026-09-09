import { createInterface } from "node:readline/promises";

export interface Prompter {
  ask(question: string): Promise<string>;
  close(): void;
}

/**
 * Readline closes as soon as a piped stream ends, which makes any scripted or
 * tested run fail on the first question. When stdin is not a TTY the answers
 * are buffered up front instead, so `cg review` can be driven from a file or a
 * heredoc as well as by hand.
 */
export async function makePrompter(): Promise<Prompter> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return {
      ask: (q) => rl.question(q),
      close: () => rl.close(),
    };
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const lines = Buffer.concat(chunks).toString("utf8").split("\n");
  let i = 0;

  return {
    async ask(q: string) {
      const answer = lines[i++] ?? "";
      // Echo so a scripted transcript reads the same as an interactive one.
      process.stdout.write(`${q}${answer}\n`);
      return answer;
    },
    close: () => {},
  };
}
