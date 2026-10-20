// Public privacy policy page. The Chrome Web Store needs a privacy policy URL that opens without
// login; the repository is private, so the worker serves PRIVACY.md (bundled at deploy time) as
// HTML at /privacy. The renderer covers only the Markdown that file uses: headings, paragraphs,
// bullet lists, one table, bold, inline code and links.
import policy from '../PRIVACY.md';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  const links: string[] = [];
  const keep = (html: string) => `\u0000${links.push(html) - 1}\u0000`;
  let out = esc(s)
    .replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`))
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, t, u) => keep(`<a href="${u}" rel="noopener">${t}</a>`))
    .replace(/https:\/\/[^\s<|)]+[^\s<|).,;]/g, (u) => keep(`<a href="${u}" rel="noopener">${u}</a>`))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => links[+i]);
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    if (list.length) html.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    if (table.length) {
      const [head, ...rows] = table;
      html.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
    }
    para = [];
    list = [];
    table = [];
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (/^\s*-\s+/.test(line)) {
      if (para.length || table.length) flush();
      list.push(line.replace(/^\s*-\s+/, ''));
    } else if (/^\|.*\|\s*$/.test(line)) {
      if (para.length || list.length) flush();
      if (/^\|[\s|:-]+\|\s*$/.test(line)) continue; // header separator row
      table.push(line.trim().slice(1, -1).split('|').map((c) => c.trim()));
    } else if (!line.trim()) flush();
    else {
      if (list.length || table.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
}

const STYLE = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1b2333;--muted:#5b6578;--line:#dde3ec;--accent:#2f5bd3;--code:#f1f4f9}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e4e9f2;--muted:#9aa5b8;--line:#243049;--accent:#8fb0ff;--code:#16203a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:1.9rem;line-height:1.25;margin:0 0 4px}
h2{font-size:1.3rem;margin:2.2em 0 .5em;padding-top:.6em;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:1.6em 0 .3em}
p,ul{margin:.6em 0}
ul{padding-left:1.3em}
li{margin:.25em 0}
a{color:var(--accent);overflow-wrap:anywhere}
code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.9em}
.table{overflow-x:auto;margin:1em 0}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--code)}
`;

let page: string | undefined;

export function privacyPage(): Response {
  page ??=
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Transora Privacy Policy</title><meta name="description" content="Privacy policy of the Transora Chrome extension.">` +
    `<style>${STYLE}</style></head><body><main>${renderMarkdown(policy)}</main></body></html>`;
  return new Response(page, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
    },
  });
}
