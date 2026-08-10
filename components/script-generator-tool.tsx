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
import type { ScriptGeneratorInput, ScriptGeneratorOutput } from "@/lib/tool-schemas";

const strategies = [
  { key: "stable", label: "稳健型", description: "重事实，先建立信任" },
  { key: "aggressive", label: "积极型", description: "快节奏，推进明确行动" },
  { key: "gentle", label: "温和型", description: "重共情，降低决策压力" },
] as const;

const sections = [
  ["answer", "问题解答"],
  ["value", "价值传递"],
  ["objection", "异议处理"],
  ["action", "引导行动"],
] as const;

const courseOptions = ["钢琴", "英语", "数学", "美术", "编程", "舞蹈", "书法", "口才", "托管", "吉他", "小提琴", "声乐", "其他"] as const;
const faqOptions = ["价格", "课时", "师资", "试听", "退费", "教材", "班型", "进度", "作业", "假期安排"] as const;

function ScriptResult({ result }: { result: ScriptGeneratorOutput }) {
  const copyContent = strategies.map((strategy) => [
    strategy.label,
    ...sections.map(([key, label]) => `${label}：${result[strategy.key][key]}`),
  ].join("\n")).concat([
    `标题建议：\n${result.title_suggestions.map((title, index) => `${index + 1}. ${title}`).join("\n")}`,
    `24小时跟进建议：${result.follow_up_advice}`,
  ]).join("\n\n");

  return (
    <div className="space-y-4" aria-live="polite">
      {strategies.map((strategy) => (
        <article key={strategy.key} className="rounded-xl border border-[#e5e5e7] bg-white p-4">
          <div className="border-b border-[#e5e5e7] pb-3">
            <h3 className="font-semibold">{strategy.label}</h3>
            <p className="mt-1 text-xs text-[#8e8e93]">{strategy.description}</p>
          </div>
          <div className="mt-4 space-y-4">
            {sections.map(([key, label]) => (
              <div key={key}>
                <p className="text-xs font-medium text-[#8e8e93]">{label}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{result[strategy.key][key]}</p>
              </div>
            ))}
          </div>
        </article>
      ))}
      <article className="rounded-xl border border-[#e5e5e7] bg-white p-4">
        <h3 className="font-semibold">附赠标题建议</h3>
        <ol className="mt-3 space-y-2 text-sm leading-6">{result.title_suggestions.map((title, index) => <li key={`${title}-${index}`} className="flex gap-3"><span className="text-[#8e8e93]">{index + 1}.</span><span>{title}</span></li>)}</ol>
      </article>
      <article className="rounded-xl bg-[#1a1a1a] p-4 text-white">
        <p className="text-xs font-medium text-white/60">24 小时跟进建议</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{result.follow_up_advice}</p>
      </article>
      <ResultActions tool="script-generator" content={copyContent} />
    </div>
  );
}

export function ScriptGeneratorTool() {
  const [basicOpen, setBasicOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [institutionName, setInstitutionName] = useState("");
  const [courseType, setCourseType] = useState("");
  const [customCourseType, setCustomCourseType] = useState("");
  const [parentQuestion, setParentQuestion] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [selectedFaqs, setSelectedFaqs] = useState<string[]>([]);
  const [teacherHighlights, setTeacherHighlights] = useState("");
  const [trialPolicy, setTrialPolicy] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptGeneratorOutput | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const resolvedCourseType = courseType === "其他" ? customCourseType.trim() : courseType;
    if (!institutionName.trim() || !courseType || !resolvedCourseType || !parentQuestion.trim()) {
      setBasicOpen(true);
      setError(courseType === "其他" && !resolvedCourseType ? "请填写其他课程类型。" : "请完整填写基础设置中的必填信息。");
      setLoading(false);
      return;
    }

    const faqContext = [
      selectedFaqs.length > 0 ? `家长常见关注项：${selectedFaqs.join("、")}` : "",
      teacherHighlights.trim() ? `师资亮点：${teacherHighlights.trim()}` : "",
      trialPolicy.trim() ? `试听政策：${trialPolicy.trim()}` : "",
    ].filter(Boolean);

    const input: ScriptGeneratorInput = {
      institution_name: institutionName.trim(),
      course_type: resolvedCourseType,
      parent_question: parentQuestion.trim(),
      price_range: priceRange.trim() || "未提供；涉及价格时需向教务确认。",
      faq_list: faqContext.length > 0 ? faqContext.join("\n") : "未提供机构常见问题与标准答案；涉及未提供信息时需向教务确认。",
    };

    try {
      setResult(
        sourceFile
          ? await postFormData<ScriptGeneratorOutput>("/api/tools/script-generator", input, sourceFile)
          : await postJson<ScriptGeneratorOutput>("/api/tools/script-generator", input),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  function toggleFaq(option: string) {
    setSelectedFaqs((current) =>
      current.includes(option) ? current.filter((item) => item !== option) : [...current, option],
    );
  }

  function fillExample() {
    setInstitutionName("星韵钢琴艺术中心");
    setCourseType("钢琴");
    setCustomCourseType("");
    setParentQuestion("你们钢琴课多少钱？孩子5岁零基础，之前在别家学过半年没兴趣了");
    setPriceRange("120-180元/课时");
    setSelectedFaqs(["价格", "课时", "师资", "试听"]);
    setAdvancedOpen(true);
    setError(null);
    setResult(null);
  }

  return (
    <ToolLayout
      eyebrow="工具 01 · 教培运营"
      title="教培客服话术生成器"
      description="填写机构真实资料与家长原话，生成稳健、积极、温和三种成交策略，以及24小时跟进动作。"
      resultTitle="三种策略，一次准备"
      resultDescription="结果严格区分策略与节奏，并以你提供的机构事实为准。"
      resultItems={["稳健型话术", "积极型话术", "温和型话术", "3 个标题建议", "24 小时跟进建议"]}
      resultContent={result ? <ScriptResult result={result} /> : undefined}
      resultFooter={
        <PromotionCard
          title="教培AI自动客服 — 7×24小时无人值守接待"
          description="基于您机构的专属知识库，自动回复家长咨询，夜间零流失"
        />
      }
    >
      <form className="space-y-6" onSubmit={handleSubmit} noValidate>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs leading-5 text-[#8e8e93]">先完成基础信息，高级设置可按需补充。</p>
          <button
            type="button"
            onClick={fillExample}
            className="focus-ring shrink-0 rounded-full border border-[#d2d2d7] bg-white px-3.5 py-2 text-xs font-medium transition-colors hover:border-[#1a1a1a] hover:bg-[#fafafa]"
          >
            快速填充示例
          </button>
        </div>

        <div className="space-y-3">
          <SettingsSection title="基础设置" description="生成话术所需的核心信息" open={basicOpen} onOpenChange={setBasicOpen}>
            <TextField
              id="institution_name"
              label="机构名称"
              hint="话术将以该机构课程顾问的身份输出。"
              placeholder="例如：晨星少儿成长中心"
              value={institutionName}
              onChange={(event) => setInstitutionName(event.target.value)}
              required
            />
            <SelectField
              id="course_type"
              label="课程类型"
              hint="选择最接近的课程类别。"
              value={courseType}
              onChange={(event) => {
                setCourseType(event.target.value);
                if (event.target.value !== "其他") setCustomCourseType("");
              }}
              required
            >
              <option value="" disabled>请选择课程类型</option>
              {courseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </SelectField>
            {courseType === "其他" ? (
              <TextField
                id="custom_course_type"
                label="其他课程类型"
                hint="请填写具体科目或班型。"
                placeholder="例如：机器人启蒙"
                value={customCourseType}
                onChange={(event) => setCustomCourseType(event.target.value)}
                required
                autoFocus
              />
            ) : null}
            <TextAreaField
              id="parent_question"
              label="家长问题"
              hint="尽量保留家长原话，便于判断真实异议。"
              placeholder="例如：你们家价格比隔壁贵，能保证效果吗？"
              rows={5}
              value={parentQuestion}
              onChange={(event) => setParentQuestion(event.target.value)}
              required
            />
          </SettingsSection>

          <SettingsSection title="高级设置" description="补充真实信息，让回复更准确" open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <TextField
              id="price_range"
              label="价格区间"
              hint="选填。模型只会使用你提供的真实价格。"
              placeholder="例如：120-180元/课时"
              value={priceRange}
              onChange={(event) => setPriceRange(event.target.value)}
            />
            <div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p id="faq-label" className="text-sm font-medium">常见问题</p>
                  <p className="mt-1 text-xs leading-5 text-[#8e8e93]">选填，可多选家长经常关注的话题。</p>
                </div>
                {selectedFaqs.length > 0 ? <span className="text-xs text-[#8e8e93]">已选 {selectedFaqs.length} 项</span> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-labelledby="faq-label">
                {faqOptions.map((option) => {
                  const selected = selectedFaqs.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleFaq(option)}
                      className={`focus-ring rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                        selected
                          ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                          : "border-[#d2d2d7] bg-white text-[#1a1a1a] hover:border-[#8e8e93]"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
            <TextField
              id="teacher_highlights"
              label="师资亮点"
              hint="选填，只填写已经确认的真实资历与教学特点。"
              placeholder="例如：音乐学院科班教师，5 年以上少儿教学经验"
              value={teacherHighlights}
              onChange={(event) => setTeacherHighlights(event.target.value)}
            />
            <TextField
              id="trial_policy"
              label="试听政策"
              hint="选填，只填写当前真实执行的试听规则。"
              placeholder="例如：可预约一次 45 分钟试听课"
              value={trialPolicy}
              onChange={(event) => setTrialPolicy(event.target.value)}
            />
            <FileDropzone
              label="导入机构资料"
              description="上传课程介绍、师资说明或机构 FAQ，内容将作为本次生成的补充事实。"
              file={sourceFile}
              onFileChange={setSourceFile}
              disabled={loading}
            />
          </SettingsSection>
        </div>
        <FormError message={error} />
        <GenerateButton loading={loading} label={result ? "重新生成三版话术" : "生成三版话术"} />
      </form>
    </ToolLayout>
  );
}
