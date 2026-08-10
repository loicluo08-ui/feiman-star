import { z } from "zod";

const requiredText = (label: string, max: number) =>
  z
    .string({
      required_error: `请填写${label}`,
      invalid_type_error: `${label}格式不正确`,
    })
    .trim()
    .min(1, `请填写${label}`)
    .max(max, `${label}内容过长`);

export const scriptGeneratorInputSchema = z
  .object({
    institution_name: requiredText("机构名称", 100),
    course_type: requiredText("课程类型", 100),
    price_range: requiredText("价格区间", 200),
    faq_list: requiredText("常见问题与标准答案", 8_000),
    parent_question: requiredText("家长问题", 2_000),
  })
  .strict();

const scriptSectionSchema = z
  .object({
    answer: z.string().min(1),
    value: z.string().min(1),
    objection: z.string().min(1),
    action: z.string().min(1),
  })
  .strict();

export const scriptGeneratorOutputSchema = z
  .object({
    stable: scriptSectionSchema,
    aggressive: scriptSectionSchema,
    gentle: scriptSectionSchema,
    title_suggestions: z.array(z.string().min(1)).length(3),
    follow_up_advice: z.string().min(1),
  })
  .strict();

export const productCopyInputSchema = z
  .object({
    product_name: requiredText("商品名称", 150),
    selling_points: requiredText("原始卖点", 4_000),
    target_audience: requiredText("目标人群", 500),
    platform: z.enum(["淘宝", "拼多多", "抖音"], {
      errorMap: () => ({ message: "请选择有效的投放平台" }),
    }),
  })
  .strict();

const copySectionSchema = z
  .object({
    hook: z.string().min(1),
    pain: z.string().min(1),
    proof: z.string().min(1),
    cta: z.string().min(1),
  })
  .strict();

export const productCopyOutputSchema = z
  .object({
    titles: z.array(z.string().min(1)).length(5),
    copies: z
      .object({
        rational: copySectionSchema,
        emotional: copySectionSchema,
        urgent: copySectionSchema,
      })
      .strict(),
    refined_selling_points: z.array(z.string().min(1)).min(3).max(5),
    competitor_insight: z.string().min(1),
  })
  .strict();

export type ScriptGeneratorInput = z.infer<typeof scriptGeneratorInputSchema>;
export type ScriptGeneratorOutput = z.infer<typeof scriptGeneratorOutputSchema>;
export type ProductCopyInput = z.infer<typeof productCopyInputSchema>;
export type ProductCopyOutput = z.infer<typeof productCopyOutputSchema>;
