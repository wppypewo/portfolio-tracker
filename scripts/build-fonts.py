#!/usr/bin/env python3
"""產生 src/app/fonts/ 底下的自架字體檔（Plex Sans、Plex Mono 三字重、Noto Sans TC）。

這支腳本**不在建置流程裡**。產出的 .woff2 直接 commit 進 repo，
Vercel 建置不需要 Python，也不需要對外抓字體。
只有要換字體、改字集、或上游字體更新時才需要重跑。

用法：

    python3 -m venv .venv-fonts
    .venv-fonts/bin/pip install fonttools brotli
    .venv-fonts/bin/python scripts/build-fonts.py               # 全部重產
    .venv-fonts/bin/python scripts/build-fonts.py --tc-slices   # 只重切繁中（改了 UI 文案時）

為什麼自架：next/font/google 本身已經會在建置時把字體抓下來自架，
執行期不連 Google。問題出在「建置時」——抓 Noto Sans TC 失敗過好幾次，
建置就跟著掛。改成本地檔案後這個外部相依整個消失。

繁中字體的載入方式（2026-10-11 起）：next/font/local 沒辦法逐檔宣告
unicode-range，所以繁中不走 next/font，改由這支腳本切片並產生
src/app/fonts/noto-sans-tc.css（手寫 @font-face + unicode-range）：

- NotoSansTC-ui.woff2：原始碼字串裡實際出現的字（去掉註解與測試檔），幾乎每頁只需要這一片
- NotoSansTC-fNN.woff2：其餘 Big5 常用字，照 Google Fonts 的切片順序（越前面越常用）
  每約 450 字併成一片，只有畫面上出現那幾個字時瀏覽器才會下載

NotoSansTC-big5.woff2 仍然產生：它是切片的來源，也是分享圖（scripts/demo-og/）用的整包字。
改了 UI 文案之後跑 `--tc-slices` 重切即可（不需要重新下載上游字體）。
新字沒進 UI 片也不會變豆腐，只是多下載一片。取捨的實測數字見 AGENTS.md。
"""

import pathlib
import re
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "app" / "fonts"
CACHE = ROOT / ".font-src"

UPSTREAM = {
    "NotoSansTC[wght].ttf": "ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
    "IBMPlexSans[wdth,wght].ttf": "ofl/ibmplexsans/IBMPlexSans%5Bwdth%2Cwght%5D.ttf",
    # IBM Plex Mono 上游只有靜態字重，沒有變數檔（google/fonts 的 ofl/ibmplexmono
    # 底下是 14 個 static ttf）。所以這支破例，只收實際用到的三個字重。
    "IBMPlexMono-Regular.ttf": "ofl/ibmplexmono/IBMPlexMono-Regular.ttf",
    "IBMPlexMono-Medium.ttf": "ofl/ibmplexmono/IBMPlexMono-Medium.ttf",
    "IBMPlexMono-SemiBold.ttf": "ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf",
}

# 等寬字集。2026-09-26 測繪桌翻新前只收數字與英數（DIGITS），因為當時 Mono
# 只服務首頁帳本的數字。翻新後 Mono 也負責測量註記、軸標、代號與 hero 大數字，
# 會出現括號、#、@、< > 之類的字元，所以擴到完整可列印 ASCII，
# 再加上註記用的幾個符號：
#   U+00A0 不斷行空白   U+00B1 ±   U+00B7 ·   U+00D7 ×
#   U+2013–2014 – —    U+2026 …   U+2190–2193 ← ↑ → ↓   U+2212 −   U+2248 ≈
# 仍然不收整個 LATIN：附加符號（重音字母等）在註記與數字裡用不到。
# Δ（U+0394）上游 Plex Mono 沒有這個字，列了也收不到，要用就掉到 Plex Sans。
MONO = (
    "U+0020-007E,U+00A0,U+00B1,U+00B7,U+00D7,U+2013-2014,U+2026,"
    "U+2190-2193,U+2212,U+2248"
)

# Google Fonts 的 "latin" 切片範圍，逐字抄自 css2 API 的輸出。
# Plex Sans 沿用這個範圍，跟改動前的涵蓋範圍一致。
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,"
    "U+2212,U+2215,U+FEFF,U+FFFD"
)

# UI 用到、但拉丁範圍與 Big5 常用字都沒收的字元。
# 少了這些，箭頭、勾勾、展開三角形會變成豆腐。
# 由 scripts/build-fonts.py 的 --audit 模式掃出來，改動 UI 文案後值得重掃一次。
EXTRA = "₿↔↻≈≤≥⊘⌕▸✓✦⤓⬆閾饋～￥"

# 繁中切片。Google Fonts 的 css2 API 把 Noto Sans TC 切成一百多片，
# 編號越大越常用（「的」「是」在最後一片）。只拿它的分組當「常用度」的依據，
# 檔案仍然從我們自己的 Big5 子集切出來。不帶現代瀏覽器的 User-Agent 時
# Google 會回單一整包、沒有 unicode-range，所以要帶。
GOOGLE_TC_CSS = "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100..900"
GOOGLE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
TC_FAMILY = "StackWorth TC"
TC_SLICE_TARGET = 450


def big5_block(lo: int, hi: int) -> set[str]:
    """把 Big5 某段前導位元組解碼成字元集合。"""
    out: set[str] = set()
    trail = list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF))
    for lead in range(lo, hi + 1):
        for t in trail:
            try:
                out.add(bytes([lead, t]).decode("big5"))
            except UnicodeDecodeError:
                pass
    return out


def fetch(name: str, path: str) -> pathlib.Path:
    CACHE.mkdir(exist_ok=True)
    dest = CACHE / name
    if not dest.exists():
        url = f"https://github.com/google/fonts/raw/main/{path}"
        print(f"  下載 {name}")
        with urllib.request.urlopen(url) as r:
            dest.write_bytes(r.read())
    return dest


def pin(src: pathlib.Path, **axes: float) -> pathlib.Path:
    """把用不到的變數軸釘死再子集化。

    IBM Plex Sans 上游帶 wght 與 wdth 兩軸，專案沒有任何地方用 font-stretch。
    留著那條軸要多 22 KB（68.3 → 46.3 KB），釘掉純賺，wght 100–700 不受影響。
    """
    dest = CACHE / f"{src.stem}-pinned.ttf"
    if not dest.exists():
        instancer.instantiateVariableFont(TTFont(src), axes, inplace=False).save(dest)
    return dest


def run(src: pathlib.Path, out: pathlib.Path, *, unicodes=None, text=None) -> None:
    args = [str(src), "--layout-features=*", "--flavor=woff2", f"--output-file={out}"]
    if unicodes:
        args.append(f"--unicodes={unicodes}")
    if text:
        args.append(f"--text={text}")
    subset.main(args)
    size = out.stat().st_size / 1024
    n = len(TTFont(out).getBestCmap())
    print(f"  {out.name}: {size:,.1f} KB / {n:,} 字")


def audit() -> None:
    """掃出 UI 文案裡拉丁與 Big5 常用字都沒收的字元，用來維護 EXTRA。"""
    ranges = []
    for part in LATIN.split(","):
        p = part.strip()[2:]
        a, _, b = p.partition("-")
        ranges.append((int(a, 16), int(b or a, 16)))
    covered = big5_block(0xA1, 0xA3) | big5_block(0xA4, 0xC6)
    missing = set()
    for pat in ("*.ts", "*.tsx", "*.css"):
        for p in (ROOT / "src").rglob(pat):
            for ch in p.read_text(encoding="utf-8", errors="ignore"):
                if ord(ch) <= 0x7F:
                    continue
                if any(a <= ord(ch) <= b for a, b in ranges) or ch in covered:
                    continue
                missing.add(ch)
    extra = set(EXTRA)
    print(f"UI 需要的額外字元 {len(missing)} 個: {''.join(sorted(missing))}")
    if missing - extra:
        print(f"  ⚠ EXTRA 沒收到: {''.join(sorted(missing - extra))}")
        sys.exit(1)
    print("  EXTRA 涵蓋完整")


def google_tc_groups() -> list[set[int]]:
    """Google 的繁中切片，由最常用排到最少用。"""
    CACHE.mkdir(exist_ok=True)
    dest = CACHE / "notosanstc-google.css"
    if not dest.exists():
        print("  下載 Google Fonts 切片定義")
        req = urllib.request.Request(GOOGLE_TC_CSS, headers={"User-Agent": GOOGLE_UA})
        with urllib.request.urlopen(req) as r:
            dest.write_bytes(r.read())
    css = dest.read_text(encoding="utf-8")
    groups = []
    for idx, ranges in re.findall(r"\.(\d+)\.woff2\).*?unicode-range: ([^;]+);", css, re.S):
        cps: set[int] = set()
        for part in ranges.split(","):
            a, _, b = part.strip()[2:].partition("-")
            cps.update(range(int(a, 16), int(b or a, 16) + 1))
        groups.append((int(idx), cps))
    if len(groups) < 50:
        sys.exit("Google 回的不是切片版 CSS（切片數太少），檢查 User-Agent")
    return [cps for _, cps in sorted(groups, reverse=True)]


def ui_codepoints(available: set[int]) -> set[int]:
    """原始碼裡會被畫出來的字：去掉區塊註解與行註解，跳過測試檔。

    行註解的規則避開「://」，網址字串後半段才不會被當成註解吃掉。
    掃得不完美也沒關係：漏掉的字仍在某個常用度切片裡，只是多一個請求。"""
    found: set[int] = set()
    for pat in ("*.ts", "*.tsx", "*.css"):
        for p in (ROOT / "src").rglob(pat):
            if ".test." in p.name:
                continue
            text = p.read_text(encoding="utf-8", errors="ignore")
            text = re.sub(r"/\*[\s\S]*?\*/", "", text)
            text = re.sub(r"(?<![:\"'])//[^\n]*", "", text)
            found |= {ord(c) for c in text if ord(c) > 0x7F and ord(c) in available}
    return found


def to_unicode_range(cps: set[int]) -> str:
    out, ordered = [], sorted(cps)
    start = prev = ordered[0]
    for cp in ordered[1:] + [None]:
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        out.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
        if cp is not None:
            start = prev = cp
    return ",".join(out)


def build_tc_slices() -> None:
    """從 NotoSansTC-big5.woff2 切出 UI 片與常用度切片，並寫出 noto-sans-tc.css。"""
    full = OUT / "NotoSansTC-big5.woff2"
    available = set(TTFont(full).getBestCmap().keys())
    for old in OUT.glob("NotoSansTC-[uf]*.woff2"):
        old.unlink()

    ui = ui_codepoints(available)
    rest = available - ui
    slices = [("ui", ui)]
    chunk: set[int] = set()
    for group in google_tc_groups():
        chunk |= group & rest
        rest -= group
        if len(chunk) >= TC_SLICE_TARGET:
            slices.append((f"f{len(slices) - 1:02d}", chunk))
            chunk = set()
    # Google 沒列到的少數 Big5 符號併進最後一片
    chunk |= rest
    if chunk:
        slices.append((f"f{len(slices) - 1:02d}", chunk))

    faces = []
    for name, cps in slices:
        out = OUT / f"NotoSansTC-{name}.woff2"
        run(full, out, unicodes=to_unicode_range(cps))
        faces.append(
            "@font-face {\n"
            f'  font-family: "{TC_FAMILY}";\n'
            "  font-style: normal;\n"
            "  font-weight: 100 900;\n"
            "  font-display: swap;\n"
            f'  src: url("./{out.name}") format("woff2");\n'
            f"  unicode-range: {to_unicode_range(cps)};\n"
            "}\n"
        )
    header = (
        "/* 由 scripts/build-fonts.py 產生，勿手改。\n"
        "   繁中字體切片：第一片是 UI 文案用到的字，其餘照常用度排序。\n"
        "   瀏覽器只下載畫面上實際出現的字所在的那幾片。 */\n"
    )
    (OUT / "noto-sans-tc.css").write_text(header + "\n".join(faces), encoding="utf-8")
    print(f"  noto-sans-tc.css: {len(faces)} 片")


def main() -> None:
    if "--audit" in sys.argv:
        audit()
        return
    if "--tc-slices" in sys.argv:
        print("重切繁中字體（沿用現有的 NotoSansTC-big5.woff2）")
        build_tc_slices()
        return

    OUT.mkdir(parents=True, exist_ok=True)
    print("取得上游變數字體")
    srcs = {n: fetch(n, p) for n, p in UPSTREAM.items()}

    print("拉丁字體（變數，一個檔涵蓋全字重）")
    run(
        pin(srcs["IBMPlexSans[wdth,wght].ttf"], wdth=100),
        OUT / "IBMPlexSans-latin.woff2",
        unicodes=LATIN,
    )

    print("等寬（靜態三字重：400 / 500 / 600，可列印 ASCII + 註記符號）")
    for weight, name in ((400, "Regular"), (500, "Medium"), (600, "SemiBold")):
        run(
            srcs[f"IBMPlexMono-{name}.ttf"],
            OUT / f"IBMPlexMono-{weight}-ascii.woff2",
            unicodes=MONO,
        )

    print("繁中字體（Big5 符號區 + 常用字 + UI 額外符號）")
    chars = big5_block(0xA1, 0xA3) | big5_block(0xA4, 0xC6) | set(EXTRA)
    run(srcs["NotoSansTC[wght].ttf"], OUT / "NotoSansTC-big5.woff2", text="".join(sorted(chars)))

    print("繁中切片（UI 片 + 常用度切片）與 noto-sans-tc.css")
    build_tc_slices()

    print("\n完成。字體檔要 commit 進 repo。")


if __name__ == "__main__":
    main()
