import { ChatPanel } from "@/components/chat-panel";

export const metadata = {
  title: "AI 对话",
};

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return <ChatPanel />;
}
