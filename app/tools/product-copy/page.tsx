import type { Metadata } from "next";
import { ProductCopyTool } from "@/components/product-copy-tool";

export const metadata: Metadata = { title: "高转化商品文案" };

export default function ProductCopyPage() {
  return <ProductCopyTool />;
}
