import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

function readPrompt(filename: string) {
  const source = readFileSync(join(process.cwd(), "prompts", filename), "utf8");
  const fencedPrompt = source.match(/```\s*\n([\s\S]*?)\n```\s*$/);

  if (!fencedPrompt?.[1]) {
    throw new Error(`Prompt file ${filename} does not contain a final fenced prompt.`);
  }

  return fencedPrompt[1];
}

export const scriptGeneratorPrompt = readPrompt("script-generator-v1.1.md");
export const productCopyPrompt = readPrompt("product-copy-v1.0.md");

export function renderPrompt(template: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (prompt, [name, value]) => prompt.replaceAll(`{{${name}}}`, value),
    template,
  );
}
