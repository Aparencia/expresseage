# PowerShell 的 `-Encoding UTF8` 会加 BOM —— 而微信编译器不认（`.ps1` 要 BOM，被编译的文件绝不能有）
现象（expresseage_college 2026-09-20）：开发者工具报 `pages/archive-detail/index.wxss(1:1): unexpected \uFEFF at pos 1` → **该页样式整体编译失败**。文件头三个字节是 `EF BB BF`。
根因：我用 `Set-Content -Path x -Encoding UTF8` 改过一批文件（Windows PowerShell 5.1 的 `-Encoding UTF8` **写出来是带 BOM 的 UTF-8**）；Node 读 `.js` 时会自动吃 BOM，所以**本地三套门禁全绿**，只有微信用自己的编译器读 `.wxss`/`.wxml` 时才炸。
为什么之前没抓住：首轮审查其实报过"6 个文件 BOM 抖动"（R-18），**我判成"只影响 .ps1、登记不改"** —— 判断错了：`.ps1` 需要 BOM（PS 5.1 读无 BOM 会按 GBK 解析），而被编译的 js/wxml/wxss/json **必须不带**。同一条"编码纪律"，两个相反方向。
修法：① 用 .NET 读写（`[IO.File]::ReadAllBytes` / `WriteAllBytes`，**绝对路径**）剥掉 BOM；② `tools/check.js` 加判据：`.js/.wxml/.wxss/.json` 带 BOM → FAIL（变异验证：加 BOM 报红、去掉复绿）；③ 判 `.ps1` 那条保持原样（必须有 BOM）。
下次定位：**"门禁全绿但开发者工具报 unexpected \uFEFF"** → 先看首三字节是不是 `EF BB BF`；凡 PowerShell 改过 UTF-8 文件，都要问一句"它加 BOM 了吗"。
来源：expresseage_college · 2026-09-20 · 柜号落库整改批（开发者工具真机日志）；同族：UTF-16LE 编码破坏 · 假 exit 码 · 工具静默改配置
