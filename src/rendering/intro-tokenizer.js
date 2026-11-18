import { Lexer, Tokenizer } from "marked";

const ANCHOR_END = /^<\/a[ \t\f\n]*>/i;
const ANCHOR_START = /^<a(?=[\s/>])/i;
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
        } else if (ANCHOR_START.test(token.raw)) open = true;
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

export function tokenizeDisplayMath(source) {
  const match = /^ {0,3}\$\$[ \t]*\n((?:(?! {0,3}(?:```|~~~))[^\n]*\n)*?) {0,3}\$\$[ \t]*(?:\n|$)/.exec(source);
  if (match)
    return { type: "math", raw: match[0], text: match[1], displayMode: true };
}

function* literalInlineRanges(tokens, offset = 0) {
  for (const token of tokens) {
    const end = offset + token.raw.length;
    if (token.escaped || ["codespan", "html", "link", "image"].includes(token.type)) {
      const linkMarkup = token.type === "html" ? ANCHOR_START.test(token.raw) : !!token.title;
      yield [offset, end, linkMarkup];
    } else if (["strong", "em", "del"].includes(token.type)) {
      yield* literalInlineRanges(token.tokens, offset + (token.raw.length - token.text.length) / 2);
    }
    offset = end;
  }
}

function displayMathBoundary(source, paragraph, options, paragraphRule) {
  const hasInlineOpener = /[<`\[]/.test(paragraph);
  const lexRanges = (input) => literalInlineRanges(Lexer.lexInline(input, {
    ...options, tokenizer: undefined, extensions: undefined,
  }));
  // A blank line can fall just before the opening delimiter as well as inside
  // the formula. In that case the block lexer can handle an unprotected opener.
  const acrossBlank = hasInlineOpener && /^\n(?:[ \t]*\n)+ {0,3}\$\$[ \t]*(?=\n|$)/.exec(source.slice(paragraph.length));
  const candidates = (acrossBlank ? source.slice(0, paragraph.length + acrossBlank[0].length) : paragraph)
    .matchAll(/(?<=\n) {0,3}\$\$[ \t]*(?=\n|$)/g);
  let ranges;
  let literal;
  for (const { index } of candidates) {
    const formula = tokenizeDisplayMath(source.slice(index));
    if (!formula) continue;
    if (!hasInlineOpener) return { start: index };
    if (!ranges) {
      ranges = lexRanges(paragraph);
      literal = ranges.next().value;
    }
    while (literal && literal[1] <= index) literal = ranges.next().value;
    if (literal && literal[0] <= index) continue;

    // Look through this formula and one adjoining native paragraph. A blank
    // after the closing delimiter can belong to an explicit link title, but
    // keep it as a boundary for code. A fence always ends the probe.
    const formulaEnd = index + formula.raw.length;
    const afterFormula = source.slice(formulaEnd);
    const gap = /^[ \t]*\n(?:[ \t]*\n)*/.exec(afterFormula)?.[0].length ?? 0;
    const tail = !gap || /\]\(|<a(?=[\s/>])/i.test(paragraph) ? afterFormula.slice(gap) : "";
    const continuation = /^ {0,3}(?:```|~~~)/.test(tail) ? 0 : paragraphRule.exec(tail)?.[0].length ?? 0;
    const probeEnd = formulaEnd + (continuation ? gap + continuation : 0);
    if (probeEnd > paragraph.length) {
      const close = formula.raw.endsWith("\n") ? formulaEnd - 1 : formulaEnd;
      for (const [start, end, linkMarkup] of lexRanges(source.slice(0, probeEnd))) {
        if (start > index || start >= paragraph.length) break;
        if (end > paragraph.length && end >= close && (!gap || end <= formulaEnd || linkMarkup)) {
          const followingFormula = /\n {0,3}\$\$[ \t]*(?=\n|$)/.test(source.slice(end, probeEnd));
          return { paragraphEnd: followingFormula ? source.indexOf("\n", end) : probeEnd };
        }
      }
    }
    if (index < paragraph.length) return { start: index };
  }
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
    const token = this.joinAnchorEnd(source, "paragraph");
    if (!token) return;
    const { start, paragraphEnd } = displayMathBoundary(source, token.text, this.options, this.rules.block.paragraph) ?? {};
    if (paragraphEnd !== undefined) {
      // Keep the verified inline span in one paragraph. Restore the original
      // line endings before inline lexing so titles and code retain their text.
      token.raw = token.text = this.lexer.inlineQueue.at(-1).src = source.slice(0, paragraphEnd);
      const joined = token.raw.replaceAll("\n", " ") + source.slice(paragraphEnd);
      return this.joinAnchorEnd(source, "paragraph", token, joined);
    }
    if (start !== undefined) {
      // Yield the whole formula to the block extension before its contents can
      // interrupt the paragraph. The preceding newline belongs to the prose.
      token.raw = source.slice(0, start);
      token.text = this.lexer.inlineQueue.at(-1).src = source.slice(0, start - 1);
    }
    return token;
  }

  text(source) {
    return this.joinAnchorEnd(source, "text");
  }

  joinAnchorEnd(source, type, token = super[type](source), input = source) {
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
