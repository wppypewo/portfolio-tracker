import { PublicFallback } from "@/components/PublicFallback";

// 公開頁不用根層的已登入骨架，原因見 PublicFallback
export default function Loading() {
  return <PublicFallback />;
}
