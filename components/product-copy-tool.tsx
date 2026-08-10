"use client";

import { type FormEvent, useState } from "react";
import { FileDropzone } from "@/components/file-dropzone";
import { FormError, GenerateButton } from "@/components/generate-button";
import { SelectField, TextAreaField, TextField } from "@/components/form-field";
import { PromotionCard } from "@/components/promotion-card";
import { ResultActions } from "@/components/result-actions";
import { SettingsSection } from "@/components/settings-section";
import { ToolLayout } from "@/components/tool-layout";
import { postFormData, postJson } from "@/lib/client-api";
import type { ProductCopyInput, ProductCopyOutput } from "@/lib/tool-schemas";

const copyStyles = [
  ["rational", "理性型正文"],
  ["emotional", "感性型正文"],
  ["urgent", "紧迫型正文"],
] as const;

const copySections = [
  ["hook", "钩子"],
  ["pain", "痛点场景"],
  ["proof", "卖点论证"],
  ["cta", "行动指令"],
] as const;

function ProductCopyResult({ result }: { result: ProductCopyOutput }) {
  const copyContent = [
    `标题5选1：\n${result.titles.map((title, index) => `${index + 1}. ${title}`).join("\n")}`,
    ...copyStyles.map(([style, label]) => [label, ...copySections.map(([section, sectionLabel]) => `${sectionLabel}：${result.copies[style][section]}`)].join("\n")),
    `卖点提炼：\n${result.refined_selling_points.map((point) => `- ${point}`).join("\n")}`,
    `竞品摘要：${result.competitor_insight}`,
  ].join("\n\n");

  return (
    <div className="space-y-4" aria-live="polite">
      <article className="rounded-xl border border-[#e5e5e7] bg-white p-4">
        <h3 className="font-semibold">标题 5 选 1</h3>
        <ol className="mt-3 space-y-2">
          {result.titles.map((title, index) => (
            <li key={`${title}-${index}`} className="flex gap-3 text-sm leading-6">
              <span className="text-[#8e8e93]">{index + 1}.</span>
              <span>{title}</span>
            </li>
          ))}
        </ol>
      </article>

      {copyStyles.map(([style, label]) => (
        <article key={style} className="rounded-xl border border-[#e5e5e7] bg-white p-4">
          <h3 className="border-b border-[#e5e5e7] pb-3 font-semibold">{label}</h3>
          <div className="mt-4 space-y-4">
            {copySections.map(([section, sectionLabel]) => (
              <div key={section}>
                <p className="text-xs font-medium text-[#8e8e93]">{sectionLabel}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{result.copies[style][section]}</p>
              </div>
            ))}
          </div>
        </article>
      ))}

      <article className="rounded-xl border border-[#e5e5e7] bg-white p-4">
        <h3 className="font-semibold">卖点提炼</h3>
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {result.refined_selling_points.map((point) => (
            <li key={point} className="flex gap-2"><span aria-hidden>·</span><span>{point}</span></li>
          ))}
        </ul>
      </article>

      <article className="rounded-xl bg-[#1a1a1a] p-4 text-white">
        <p className="text-xs font-medium text-white/60">同类文案洞察</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{result.competitor_insight}</p>
        <p className="mt-3 border-t border-white/15 pt-3 text-xs leading-5 text-white/55">AI 基于常识分析，仅供参考，不代表实时市场数据。</p>
      </article>
      <ResultActions tool="product-copy" content={copyContent} />
    </div>
  );
}

export function ProductCopyTool() {
  const [basicOpen, setBasicOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [platform, setPlatform] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProductCopyOutput | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (!productName.trim() || !sellingPoints.trim() || !platform) {
      setBasicOpen(true);
      setError("请完整填写基础设置中的必填信息。");
      setLoading(false);
      return;
    }

    const input: ProductCopyInput = {
      product_name: productName.trim(),
      selling_points: sellingPoints.trim(),
      platform: platform as ProductCopyInput["platform"],
      target_audience: targetAudience.trim() || "未明确；请根据商品信息概括典型使用人群，不得编造具体人口数据。",
    };

    try {
      setResult(
        sourceFile
          ? await postFormData<ProductCopyOutput>("/api/tools/product-copy", input, sourceFile)
          : await postJson<ProductCopyOutput>("/api/tools/product-copy", input),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolLayout
      eyebrow="工具 02 · 电商运营"
      title="高转化商品文案"
      description="输入商品事实、目标人群和投放平台，生成标题、三版正文、卖点提炼与同类文案洞察。"
      resultTitle="一套完整文案包"
      resultDescription="标题、正文和卖点分别处理，避免只做简单换词。"
      resultItems={["5 个标题方向", "理性 / 感性 / 紧迫三版正文", "3–5 条卖点提炼", "同类文案洞察"]}
      notice="AI 基于常识分析，仅供参考。竞品洞察不代表实时市场数据。"
      resultContent={result ? <ProductCopyResult result={result} /> : undefined}
      resultFooter={
        <PromotionCard
          title="电商AI内容管家 — 全平台文案一键生成"
          description="商品描述、活动文案、评价回复，一个工具全搞定"
        />
      }
    >
      <form className="space-y-6" onSubmit={handleSubmit} noValidate>
        <p className="text-xs leading-5 text-[#8e8e93]">先填写商品事实，高级设置可帮助模型进一步聚焦人群。</p>
        <div className="space-y-3">
          <SettingsSection title="基础设置" description="商品事实与投放平台" open={basicOpen} onOpenChange={setBasicOpen}>
            <TextField
              id="product_name"
              label="商品名称"
              hint="填写消费者能够识别的具体商品名。"
              placeholder="例如：男士冰丝速干运动短袖"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              required
            />
            <SelectField
              id="platform"
              label="投放平台"
              hint="不同平台将采用不同标题和正文节奏。"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              required
            >
              <option value="" disabled>请选择平台</option>
              <option value="淘宝">淘宝</option>
              <option value="拼多多">拼多多</option>
              <option value="抖音">抖音</option>
            </SelectField>
            <TextAreaField
              id="selling_points"
              label="原始卖点"
              hint="只填写真实、可证明的材质、规格、功能和服务信息。"
              placeholder="例如：冰丝面料；透气速干；3 件装；多色可选"
              rows={6}
              value={sellingPoints}
              onChange={(event) => setSellingPoints(event.target.value)}
              required
            />
          </SettingsSection>

          <SettingsSection title="高级设置" description="选填目标人群，提高场景准确度" open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <TextField
              id="target_audience"
              label="目标人群"
              hint="选填。包含年龄、场景和主要需求会更准确。"
              placeholder="例如：25–35 岁、经常健身和通勤的男性"
              value={targetAudience}
              onChange={(event) => setTargetAudience(event.target.value)}
            />
            <FileDropzone
              label="导入商品资料"
              description="上传产品手册、卖点文档或竞品分析，内容将作为本次生成的补充事实。"
              file={sourceFile}
              onFileChange={setSourceFile}
              disabled={loading}
            />
          </SettingsSection>
        </div>
        <FormError message={error} />
        <GenerateButton loading={loading} label={result ? "重新生成文案包" : "生成文案包"} />
      </form>
    </ToolLayout>
  );
}
