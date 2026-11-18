import { Lexer, Tokenizer } from "marked";

const ANCHOR_END = /^<\/a[ \t\f\n]*>/i;
const BEFORE_ANCHOR_END = /^[ \t]*\n[ \t\n]*(?=<\/a[ \t\f\n]*>)/i;
const RAW_TEXT_TAG = /^<(iframe|noembed|noframes|noscript|plaintext|script|style|textarea|title|xmp)(?=[\s/>])/i;

function isInlineAnchorEnd(tokens, start, needsOpenAnchor) {
  let open = false;
  function visit(items, offset) {
    for (const token of items) {
      if (offset > start) break;
      if (token.type === "html") {
        if (ANCHOR_END.test(token.raw)) {
          if (offset === start) return !needsOpenAnchor || open;
          open = false;
        } else if (/^<a(?=[\s/>])/i.test(token.raw)) open = true;
      } else if (["strong", "em", "del"].includes(token.type)) {
        const delimiterLength = (token.raw.length - token.text.length) / 2;
        if (visit(token.tokens, offset + delimiterLength)) return true;
      }
      offset += token.raw.length;
    }
    return false;
  }
  return visit(tokens, 0);
}

function findSplitAnchorEnd(text, source) {
  const partial = /<\/a[ \t\f]*$/i.exec(text);
  const gap = !partial && BEFORE_ANCHOR_END.exec(source.slice(text.length))?.[0];
  if (!partial && !gap) return;
  const start = partial ? partial.index : text.length + gap.length;
  const endTag = ANCHOR_END.exec(source.slice(start))?.[0];
  if (endTag) return { start, endTag, joinFrom: gap ? text.length : start };
}

function htmlBlockEnd(source, end, tagRule) {
  const blankLine = /\n[ \t]*\n/g;
  let offset = 0;
  // Walk complete tags across the tentative block boundary. The tag grammar
  // treats quoted attributes as a unit, including any tag-shaped text in them.
  for (let start; (start = source.indexOf("<", offset)) !== -1 && start < end;) {
    const tag = tagRule.exec(source.slice(start))?.[0];
    offset = start + (tag?.length || 1);
    if (!tag) continue;
    if (offset > end) {
      blankLine.lastIndex = offset;
      end = blankLine.exec(source)?.index ?? source.length;
    }
    const rawText = RAW_TEXT_TAG.exec(tag)?.[1];
    if (rawText) {
      if (rawText.toLowerCase() === "plaintext") break;
      const close = new RegExp(`</${rawText}[ \\t\\f\\n]*>`, "ig");
      close.lastIndex = offset;
      if (!close.exec(source.slice(0, end))) break;
      offset = close.lastIndex;
    }
  }
  return end;
}

export class IntroTokenizer extends Tokenizer {
  html(source) {
    const token = super.html(source);
    if (token && token.raw.length < source.length && /^ {0,3}<\/?[a-z]/i.test(source) &&
        !/^ {0,3}<(?:pre|script|style|textarea)(?=[\s>])/i.test(source)) {
      const end = htmlBlockEnd(source, token.raw.length, this.rules.inline.tag);
      token.raw = token.text = source.slice(0, end);
    }
    return token;
  }

  paragraph(source) {
    return this.joinAnchorEnd(source, "paragraph");
  }

  text(source) {
    return this.joinAnchorEnd(source, "text");
  }

  joinAnchorEnd(source, type) {
    let input = source;
    let token = super[type](input);
    while (token) {
      const split = findSplitAnchorEnd(token.text, input);
      if (!split) break;
      const { start, endTag, joinFrom } = split;
      const end = start + endTag.length;
      const lineEnd = input.indexOf("\n", end);
      const tokens = Lexer.lexInline(input.slice(0, lineEnd < 0 ? input.length : lineEnd),
        { ...this.options, tokenizer: undefined });
      if (!isInlineAnchorEnd(tokens, start, joinFrom !== start)) break;

      // Marked can treat the end tag's closing line as a quote or a new block.
      input = input.slice(0, joinFrom) + input.slice(joinFrom, end).replaceAll("\n", " ") + input.slice(end);
      this.lexer.inlineQueue.pop();
      token = super[type](input);
    }
    if (token && input !== source) {
      token.raw = source.slice(0, token.raw.length);
      token.text = this.lexer.inlineQueue.at(-1).src = source.slice(0, token.text.length);
    }
    return token;
  }

  tag(source) {
    const token = super.tag(source);
    if (token && ANCHOR_END.test(token.raw)) this.lexer.state.inLink = token.inLink = false;
    return token;
  }

  br(source) {
    // A blank line joined only to keep the closing tag in this paragraph is
    // literal whitespace. It should not create visible hard line breaks.
    const raw = this.lexer.state.inLink && /^[ \t]*\n[ \t]*\n[ \t\n]*(?=<\/a[ \t\f\n]*>)/i.exec(source)?.[0];
    return raw ? { type: "html", raw, text: raw } : super.br(source);
  }
}
