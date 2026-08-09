export const PLAN_CONFIG = {
  free: { label: "Free", price: 0, dailyCalls: 15, durationDays: null },
  lite: { label: "Lite", price: 9.9, dailyCalls: 50, durationDays: 30 },
  pro: { label: "Pro", price: 29, dailyCalls: 200, durationDays: 30 },
  vip: { label: "VIP", price: 99, dailyCalls: -1, durationDays: 30 },
} as const;

export type PlanName = keyof typeof PLAN_CONFIG;
export type RedeemablePlan = Exclude<PlanName, "free">;

export function isRedeemablePlan(value: string): value is RedeemablePlan {
  return value === "lite" || value === "pro" || value === "vip";
}
