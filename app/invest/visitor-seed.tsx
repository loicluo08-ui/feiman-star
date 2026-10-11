"use client";

import { useEffect } from "react";
import { seedVisitorId } from "@/lib/visitor-id";

// 访客指纹锚挂载点（10/11"修"）：invest页面加载即采集指纹种fx_vid cookie
// fire-and-forget——指纹失败静默（监控降级回IP锚），永不阻塞页面渲染
export default function VisitorSeed() {
  useEffect(() => {
    void seedVisitorId();
  }, []);
  return null;
}
