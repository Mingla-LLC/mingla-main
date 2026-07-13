import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from '../../mingla-business/node_modules/markdown-it/index.mjs';

const source = process.argv[2];
if (!source || path.extname(source) !== '.md') {
  console.error('Usage: node Mingla_Artifacts/scripts/render-doc.mjs <document.md>');
  process.exit(1);
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const markdown = fs.readFileSync(source, 'utf8');
const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(source, '.md');
const body = md.render(markdown);
const output = source.replace(/\.md$/, '.html');
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</title>
  <style>
    :root { color-scheme: light; --ink:#231f20; --muted:#6e6262; --line:#eadfda; --paper:#fffaf6; --accent:#ff5f4d; --accent-soft:#ffe8e1; }
    * { box-sizing: border-box; }
    body { margin:0; background:linear-gradient(145deg,#fff3ec,#fffaf6 35%,#f7f0ff); color:var(--ink); font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(980px,calc(100% - 32px)); margin:40px auto; padding:clamp(28px,6vw,72px); background:rgba(255,255,255,.92); border:1px solid rgba(255,255,255,.9); border-radius:28px; box-shadow:0 24px 70px rgba(81,48,38,.12); }
    h1 { margin:0 0 30px; font-size:clamp(34px,6vw,62px); line-height:1.03; letter-spacing:-.045em; }
    h2 { margin:44px 0 14px; padding-top:18px; border-top:1px solid var(--line); font-size:28px; line-height:1.2; letter-spacing:-.02em; }
    h3 { margin:28px 0 8px; font-size:20px; }
    p { margin:10px 0 18px; }
    strong { color:#120f10; }
    blockquote { margin:24px 0; padding:20px 24px; border-left:5px solid var(--accent); border-radius:0 16px 16px 0; background:var(--accent-soft); font-size:20px; }
    table { width:100%; margin:20px 0 30px; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid var(--line); border-radius:16px; font-size:15px; }
    th,td { padding:13px 15px; vertical-align:top; border-bottom:1px solid var(--line); border-right:1px solid var(--line); }
    th { background:#fff1eb; text-align:left; font-weight:750; }
    tr:last-child td { border-bottom:0; }
    th:last-child,td:last-child { border-right:0; }
    ul,ol { padding-left:24px; }
    li { margin:7px 0; }
    code { padding:2px 7px; border-radius:7px; background:#f5eeee; font-size:.88em; }
    a { color:#b92f22; }
    @media (max-width:700px) { main { width:100%; margin:0; border-radius:0; padding:28px 20px 56px; } table { display:block; overflow-x:auto; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;

fs.writeFileSync(output, html);
console.log(output);
