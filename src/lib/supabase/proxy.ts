import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session 刷新 + 未登入導向。Next 16 用 Proxy（root src/proxy.ts）每個 request 呼叫此函式。
//
// extraRequestHeaders 是給 CSP 用的（x-nonce 與 Content-Security-Policy）。
// 這些標頭必須進到往下傳的 request 裡，Next 才解析得出 nonce。
// 每次都用 new Headers(request.headers) 重建而不是共用同一個物件：
// 下面的 setAll 會先 request.cookies.set() 再重建 response，
// 共用舊物件的話那些更新過的 cookie 就不會被帶下去。
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>,
) {
  const nextInit = () => {
    if (!extraRequestHeaders) return { request };
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(extraRequestHeaders)) {
      headers.set(key, value);
    }
    return { request: { headers } };
  };

  let supabaseResponse = NextResponse.next(nextInit());

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next(nextInit());
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 重要：建立 client 後必須立刻呼叫 getUser()，中間不要插入其他邏輯，
  // 否則 session 可能被隨機登出（Supabase 官方提醒）。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // 未登入，且不在 /login、/auth/*（OAuth callback）、/demo（公開展示頁）、
  // /methodology（公開指標說明頁，從 demo 連入）或 /about（公開介紹頁）→ 導向登入頁
  // （根路徑例外，導向介紹頁）。
  if (
    !user &&
    !path.startsWith("/login") &&
    !path.startsWith("/auth") &&
    !path.startsWith("/demo") &&
    !path.startsWith("/methodology") &&
    !path.startsWith("/about")
  ) {
    const url = request.nextUrl.clone();
    // 根路徑是第一次來的人最常打的網址：沒登入的人先看介紹頁，
    // 介紹頁上有登入入口；其他受保護的頁面照舊直接到登入頁。
    url.pathname = path === "/" ? "/about" : "/login";
    return NextResponse.redirect(url);
  }

  // 已登入但有 MFA factor 且 session 仍為 AAL1 → 導向 /auth/mfa 升級到 AAL2。
  // /auth/mfa、/auth/signout、/login 不檢查避免 redirect loop。
  if (
    user &&
    !path.startsWith("/auth/mfa") &&
    !path.startsWith("/auth/signout") &&
    !path.startsWith("/login")
  ) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (
      aal &&
      aal.nextLevel === "aal2" &&
      aal.currentLevel === "aal1"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/mfa";
      // 帶 next 參數，驗完轉回原本要去的頁面
      if (path !== "/") url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
