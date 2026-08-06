import type { Metadata } from "next";
import { ScriptGeneratorTool } from "@/components/script-generator-tool";

export const metadata: Metadata = { title: "教培客服话术生成器" };

export default function ScriptGeneratorPage() {
  return <ScriptGeneratorTool />;
}
