import { KnowledgeManager } from "@/components/knowledge-manager";

export const metadata = {
  title: "知识库",
};

export const dynamic = "force-dynamic";

export default function KnowledgePage() {
  return <KnowledgeManager />;
}
