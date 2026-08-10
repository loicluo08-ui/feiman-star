import type { Metadata } from "next";
import { ScriptGeneratorTool } from "@/components/script-generator-tool";

export const metadata: Metadata = { title: "教培客服话术" };

export default function EduScriptPage() {
  return <ScriptGeneratorTool />;
}
