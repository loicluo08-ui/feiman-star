import "server-only";
import { readFileSync } from "fs";
import { join } from "path";

let cachedKnowledge: string | null = null;

/**
 * 加载费曼星投资知识库（静态文件，构建时读取）
 */
export function loadKnowledgeBase(): string {
  if (cachedKnowledge) return cachedKnowledge;
  try {
    const filePath = join(process.cwd(), "data", "investment-knowledge-base.md");
    cachedKnowledge = readFileSync(filePath, "utf-8");
    return cachedKnowledge;
  } catch {
    return "";
  }
}

/**
 * 提取与指定行业相关的知识库片段
 */
export function getRelevantKnowledge(sector: string | null): string {
  const full = loadKnowledgeBase();
  if (!full) return "";

  if (!sector) {
    // 没有行业信息，返回模块2（财务指标解读）+ 模块7（追问清单）
    const module2 = extractModule(full, "模块2");
    const module7 = extractModule(full, "模块7");
    return [module2, module7].filter(Boolean).join("\n\n---\n\n");
  }

  // 有行业信息，返回对应行业的基准 + 模块2 + 模块3
  const sectorMatch = extractSector(full, sector);
  const module2 = extractModule(full, "模块2");
  const module3 = extractModule(full, "模块3");

  return [sectorMatch, module2, module3].filter(Boolean).join("\n\n---\n\n");
}

function extractModule(text: string, moduleName: string): string {
  const start = text.indexOf(moduleName);
  if (start === -1) return "";
  // 找到下一个模块或文件末尾
  const nextModule = text.indexOf("## 模块", start + moduleName.length);
  const nextModule2 = text.indexOf("# 模块", start + moduleName.length);
  const ends = [nextModule, nextModule2].filter((e) => e !== -1);
  const end = ends.length > 0 ? Math.min(...ends) : text.length;
  return text.slice(start, end).trim();
}

function extractSector(text: string, sector: string): string {
  // 尝试匹配行业名称
  const sectorLower = sector.toLowerCase();
  const lines = text.split("\n");
  const result: string[] = [];
  let inSector = false;
  let captureDepth = 0;

  for (const line of lines) {
    if (line.match(/^#+\s*\d+\.\d*\s*\S/i) || line.match(/^#+\s*\d+\.\s/i)) {
      // 这是一个行业标题
      if (line.toLowerCase().includes(sectorLower) ||
          (sectorLower.includes("tech") && line.toLowerCase().includes("科技")) ||
          (sectorLower.includes("tech") && line.toLowerCase().includes("信息")) ||
          (sectorLower.includes("health") && line.toLowerCase().includes("医疗")) ||
          (sectorLower.includes("financ") && line.toLowerCase().includes("金融")) ||
          (sectorLower.includes("energy") && line.toLowerCase().includes("能源")) ||
          (sectorLower.includes("consum") && line.toLowerCase().includes("消费")) ||
          (sectorLower.includes("utilit") && line.toLowerCase().includes("公用")) ||
          (sectorLower.includes("real") && line.toLowerCase().includes("房地产")) ||
          (sectorLower.includes("material") && line.toLowerCase().includes("材料")) ||
          (sectorLower.includes("industr") && line.toLowerCase().includes("工业")) ||
          (sectorLower.includes("communication") && line.toLowerCase().includes("通信"))) {
        inSector = true;
        captureDepth = 0;
      } else if (inSector) {
        // 已经离开当前行业
        break;
      }
    }
    if (inSector) {
      result.push(line);
      captureDepth++;
      if (captureDepth > 30) break; // 限制提取长度
    }
  }

  return result.join("\n");
}
