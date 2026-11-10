import { marked } from "marked";
import fs from "node:fs";

const md = fs.readFileSync(process.env.FIXES_MD || "docs/fixes/JB-Router-fixes-report.md", "utf8");
// The Markdown report wraps prose in <div dir="rtl"> blocks; the page itself is
// already RTL, so drop the wrappers to keep the DOM clean.
// The report is authored for GitHub with <div dir="rtl"> wrappers; this page is
// already RTL, so both the openers and the stray closers are dropped.
const cleaned = md.replace(/<div dir="rtl">/g, "").replace(/<\/div>/g, "");
const body = marked.parse(cleaned, { gfm: true, breaks: false });

const page = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>گزارش اصلاح باگ‌ها و اجرای تست — JB-Router</title>
<style>
  :root{--bg:#0f1115;--panel:#161a21;--panel2:#1c222b;--fg:#e8ecf3;--muted:#9aa6b8;--acc:#E56A4A;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--line:#2a3240;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:"Vazirmatn","Segoe UI","IRANSans","Tahoma",system-ui,-apple-system,sans-serif;
    line-height:1.95;font-size:16px;}
  .wrap{max-width:1020px;margin:0 auto;padding:28px 22px 90px;}
  .top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .back{display:inline-flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--line);
    color:var(--fg);text-decoration:none;padding:8px 14px;border-radius:10px;font-size:14px}
  .back:hover{border-color:var(--acc);color:var(--acc)}
  .tag{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:4px 10px}
  h1{font-size:1.85rem;line-height:1.5;margin:.3em 0 .7em;border-bottom:2px solid var(--acc);padding-bottom:.4em}
  h2{font-size:1.35rem;margin:2.2em 0 .7em;padding:.4em .7em;background:linear-gradient(90deg,var(--panel2),transparent);
     border-right:4px solid var(--acc);border-radius:6px}
  h3{font-size:1.1rem;margin:1.6em 0 .5em;color:#ffd9cc}
  p{margin:.7em 0}
  a{color:var(--acc);text-decoration:none}
  a:hover{text-decoration:underline}
  hr{border:0;border-top:1px solid var(--line);margin:2.4em 0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;
    background:#0b0e13;border:1px solid var(--line);border-radius:6px;padding:.1em .38em;direction:ltr;display:inline-block}
  pre{background:#0b0e13;border:1px solid var(--line);border-radius:12px;padding:14px 16px;overflow:auto;direction:ltr;text-align:left}
  pre code{border:0;background:none;padding:0;display:block;line-height:1.7}
  table{width:100%;border-collapse:collapse;margin:1.1em 0;font-size:14.5px;background:var(--panel);border-radius:10px;overflow:hidden}
  th,td{border:1px solid var(--line);padding:9px 12px;text-align:right;vertical-align:top}
  th{background:var(--panel2);color:#cfe0ff;font-weight:700}
  tbody tr:nth-child(even){background:rgba(255,255,255,.02)}
  blockquote{margin:1em 0;padding:.6em 1em;border-right:4px solid var(--acc);background:var(--panel);border-radius:8px;color:var(--muted)}
  ul,ol{padding-right:1.4em}
  li{margin:.35em 0}
  strong{color:#fff}
  @media print{body{background:#fff;color:#000}.back{display:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="back" href="../">← صفحه اصلی</a>
    <a class="back" href="../preview/">پیش‌نمایش داشبورد</a>
    <a class="back" href="../review/">گزارش بازبینی کد</a>
    <span class="tag">JB-Router · v0.5.90 · فارسی</span>
  </div>
  ${body}
</div>
</body>
</html>`;

fs.writeFileSync("docs/fixes/index.html", page);
console.log("written:", page.length, "bytes");
