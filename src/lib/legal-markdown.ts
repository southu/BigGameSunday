/** Render Counsel legal markdown (headings, lists, links, bold, hard breaks). */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return escapeHtml(trimmed);
  return "#";
}

function renderInline(text: string): string {
  let i = 0;
  let out = "";
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        out += `<strong>${escapeHtml(text.slice(i + 2, end))}</strong>`;
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "[") {
      const close = text.indexOf("](", i);
      if (close !== -1) {
        const endParen = text.indexOf(")", close + 2);
        if (endParen !== -1) {
          const label = text.slice(i + 1, close);
          const href = text.slice(close + 2, endParen);
          out += `<a href="${safeHref(href)}">${renderInline(label)}</a>`;
          i = endParen + 1;
          continue;
        }
      }
    }
    let next = text.length;
    const star = text.indexOf("**", i);
    const brack = text.indexOf("[", i);
    if (star !== -1) next = Math.min(next, star);
    if (brack !== -1) next = Math.min(next, brack);
    if (next === i) {
      out += escapeHtml(text[i] ?? "");
      i += 1;
    } else {
      out += escapeHtml(text.slice(i, next));
      i = next;
    }
  }
  return out;
}

function renderParagraph(lines: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const hard = / {2}$/.test(line);
    const text = hard ? line.replace(/ {2}$/, "") : line;
    parts.push(renderInline(text));
    if (i < lines.length - 1) parts.push(hard ? "<br />\n" : "\n");
  }
  return `<p>${parts.join("")}</p>`;
}

function isHeading(line: string): RegExpMatchArray | null {
  return /^(#{1,6}) (.+)$/.exec(line);
}

function isHr(line: string): boolean {
  return /^---+$/.test(line.trim());
}

function isListItem(line: string): boolean {
  return /^- /.test(line);
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const heading = isHeading(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      out.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      i += 1;
      continue;
    }

    if (isHr(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (isListItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i] ?? "")) {
        items.push(`<li>${renderInline((lines[i] ?? "").slice(2))}</li>`);
        i += 1;
      }
      out.push(`<ul>\n${items.join("\n")}\n</ul>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "") break;
      if (isHeading(next) || isHr(next) || isListItem(next)) break;
      para.push(next);
      i += 1;
    }
    if (para.length > 0) out.push(renderParagraph(para));
  }

  return out.join("\n");
}
