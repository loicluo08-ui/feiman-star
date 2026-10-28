// 深度分析模式（10/28 AgentMore多步自主任务映射——费曼星agent化第一站）
// 用户给目标 → AI拆解成3-6个子问题 → 逐个跑agent数据收集 → 汇总成报告
// 后台执行：background-task.ts（进程内任务表，短任务<2min窗口；跨实例丢失风险V1已知接受）
// 判断纪律继承：汇总prompt复用宪法层（判断先行/反方/失效条件/诚实边界）——agent模式不降分析标准
import { callAI } from "@/lib/ai";
import { runAgentDataCollection } from "@/lib/agent-tools";
import { updateTaskProgress } from "@/lib/background-task";

export interface DeepAnalysisResult {
  goal: string;
  subQuestions: string[];
  report: string;
  toolsUsed: string[];
  finishedAt: string;
}

/** 三段执行：拆解→逐个收集→汇总。全程updateTaskProgress驱动前端进度 */
export async function runDeepAnalysis(
  taskId: string,
  goal: string
): Promise<DeepAnalysisResult> {
  updateTaskProgress(taskId, "拆解目标中…");

  // 段1：拆解（Hobby 60s预算：timeout 15s；免费池可胜任结构化拆解且快）
  const planRaw = await callAI(
    [
      {
        role: "user",
        content: [
          `用户目标：${goal.slice(0, 800)}`,
          "",
          "把这个目标拆解成3-5个具体的子问题，每个子问题都能通过行情/财报/快讯等数据收集回答。",
          "要求：子问题覆盖目标的不同侧面（基本面/技术面/情绪/风险），按分析顺序排列。",
          '输出纯JSON：{"questions":["子问题1","子问题2",...]}',
        ].join("\n"),
      },
    ],
    { temperature: 0.3, max_tokens: 600, timeout: 15_000, retry: 0, task: "extract", responseFormat: "json" }
  );
  let subQuestions: string[] = [];
  try {
    const parsed = JSON.parse((planRaw || "").replace(/```json|```/g, "").trim()) as { questions?: unknown };
    if (Array.isArray(parsed.questions)) {
      subQuestions = parsed.questions
        .filter((q): q is string => typeof q === "string" && q.trim().length > 3)
        .slice(0, 5);
    }
  } catch {
    // 拆解失败=单问题兜底（退化为目标本身）
  }
  if (subQuestions.length === 0) subQuestions = [goal.slice(0, 200)];

  // 段2：并行收集（10/28交叉验证修正——Hobby版函数cap 60s，串行5×20s+拆解+汇总必超时；
  // 并行化后时间=拆解15s+max(收集)30s+汇总35s≤60s预算内。失败子任务降级为占位不拖垮整体）
  const materials: string[] = new Array(subQuestions.length).fill("");
  const toolsUsed = new Set<string>();
  await Promise.all(
    subQuestions.map(async (sq, i) => {
      try {
        const collect = await runAgentDataCollection(
          [{ role: "user", content: sq }],
          () => {} // 后台任务无流式，status静默
        );
        materials[i] = collect.blocks.length > 0 ? `## ${sq}\n${collect.blocks.join("\n\n")}` : `## ${sq}\n（该子问题无可用数据）`;
        for (const t of collect.toolsUsed) toolsUsed.add(t);
      } catch {
        materials[i] = `## ${sq}\n（数据收集失败——汇总时如实标注）`;
      }
    })
  );
  updateTaskProgress(taskId, `收集完成，汇总分析中…`);

  // 段3：汇总（主池+判断纪律prompt——agent模式不降分析标准；timeout 35s卡60s预算）
  updateTaskProgress(taskId, "汇总分析中…");
  const report = await callAI(
    [
      {
        role: "user",
        content: [
          `用户目标：${goal.slice(0, 800)}`,
          "",
          "以下是逐个子问题收集的数据材料：",
          "",
          materials.filter(Boolean).join("\n\n---\n\n").slice(0, 24_000),
          "",
          "任务：基于上述材料完成用户目标，输出完整分析报告。",
          "纪律：①判断先行，第一句就是核心结论；②材料里有的数据才可引用，材料没有的明确标注「材料未覆盖」；",
          "③多空论据都要给，失效条件必须写；④数据逐条标注来源工具；⑤材料不足的部分如实说，禁止编造。",
        ].join("\n"),
      },
    ],
    { temperature: 0.4, max_tokens: 2500, timeout: 35_000, retry: 0 }
  );

  updateTaskProgress(taskId, "完成");
  return {
    goal: goal.slice(0, 800),
    subQuestions,
    report: (report || "").trim() || "（汇总生成失败——材料已收集，请重试）",
    toolsUsed: Array.from(toolsUsed),
    finishedAt: new Date().toISOString(),
  };
}
