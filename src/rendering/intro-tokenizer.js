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

const DISPLAY_MATH_LINE = /^ {0,3}\$\$[ \t]*(?=\n|$)/gm;
const INLINE_OPENER = /[<\x60\[]/;
const TITLE_OPENER = /\]\(|<a(?=[\s/>])/i;
const FENCE_START = /^ {0,3}(?:\x60{3}|~~~)/;
const ORDERED_CONTINUATION = /\n {0,3}\d{1,9}[.)](?=[ \t\n]|$)/;
const MAX_LITERAL_LOOKAHEAD = 32_768;
const MAX_FORMULA_REGIONS = 8;

function tightTextEnd(source, masked, end, lexRanges) {
  // Unlike a paragraph, tight list text can be followed immediately by an
  // ordered sublist starting at any number.
  const starts = masked.slice(0, end).matchAll(/(?<=\n) {0,3}\d{1,9}[.)](?=[ \t\n]|$)/g);
  let ranges;
  let literal;
  for (const { index } of starts) {
    if (!ranges) {
      ranges = lexRanges(source.slice(0, end));
      literal = ranges.next().value;
    }
    while (literal && literal[1] <= index) literal = ranges.next().value;
    if (!literal || index < literal[0]) return index - 1;
  }
  return end;
}

function opensLaterCode(source, from, to, lexRanges, paragraphRule) {
  if (source[to - 1] !== "\x60") return false;
  const delimiter = /^\x60+/.exec(source.slice(from, to))?.[0];
  if (!delimiter) return false;
  const probe = delimiter + source.slice(to, to + MAX_LITERAL_LOOKAHEAD);
  const paragraph = paragraphRule.exec(probe)?.[1];
  if (!paragraph) return false;
  // Marked paragraphs can include an ordered marker starting above 1.
  // Keep the local inline probe on this side of any such list boundary.
  const boundary = paragraph.search(ORDERED_CONTINUATION);
  const local = boundary < 0 ? paragraph : paragraph.slice(0, boundary);
  const span = lexRanges(local).next().value;
  if (span?.[0] !== 0) return false;

  // Keep an actual closer when treating it as an opener would steal the
  // start of another complete span that follows it in the same paragraph.
  const nextDelimiter = span[1] - 2 * delimiter.length;
  for (const [start, end] of lexRanges(local.slice(delimiter.length))) {
    if (start <= nextDelimiter && nextDelimiter < end) return false;
    if (start > nextDelimiter) break;
  }
  return true;
}

function orderedChildFormula(source, [from, to], index, lexRanges, paragraphRule) {
  const indent = source.indexOf("$", index) - index;
  if (indent < 2) return false;
  const prefix = source.slice(Math.max(from, index - MAX_LITERAL_LOOKAHEAD), index);
  for (const [, marker, gap] of prefix.matchAll(/\n( {0,3}\d{1,9}[.)])(?:( +)(?=\S)| *(?=\n))/g)) {
    if (marker.length + (gap?.length ?? 1) <= indent)
      return opensLaterCode(source, from, to, lexRanges, paragraphRule);
  }
  return false;
}

function tightParagraphEnd(source, end, paragraphRule) {
  // Marked interrupts a paragraph at 1. but permits other ordered markers.
  // Inspect that continuation provisionally. Literal verification and the
  // actual list cutoff still use the unmodified markers.
  if (!/^\n {0,3}1[.)][ \t]/.test(source.slice(end, end + 8))) return end;
  const from = end + 1;
  const tail = source.slice(from, from + MAX_LITERAL_LOOKAHEAD)
    .replace(/(?<=\n {0,3})1(?=[.)][ \t])/g, "2");
  const probe = paragraphRule.exec(tail)?.[1].replace(/\n$/, "");
  return probe ? from + probe.length : end;
}

function nextFormulaEnd(source, from, paragraph) {
  for (const line of paragraph.matchAll(DISPLAY_MATH_LINE)) {
    const index = from + line.index;
    const formula = tokenizeDisplayMath(source.slice(index));
    if (formula) return index + formula.raw.length;
  }
}

function continueLiteral(source, paragraph, start, formula, lexRanges, paragraphRule) {
  const probe = source.slice(0, start + MAX_LITERAL_LOOKAHEAD);
  const formulaEnd = start + formula.raw.length;
  if (formulaEnd > probe.length) return;
  const mayCrossBlank = TITLE_OPENER.test(paragraph);
  let firstBlank = Infinity;
  let end = formulaEnd;

  // Inspect adjacent native paragraphs and complete candidate formulas without
  // swallowing an unrelated block or scanning the rest of the introduction.
  for (let regions = 1; regions <= MAX_FORMULA_REGIONS; regions++) {
    const gap = /^[ \t]*\n(?:[ \t]*\n)*/.exec(probe.slice(end))?.[0].length ?? 0;
    if (gap && !mayCrossBlank) break;
    const from = end + gap;
    const tail = probe.slice(from);
    const continuation = !FENCE_START.test(tail) && paragraphRule.exec(tail)?.[0];
    if (!continuation) break;
    if (gap) firstBlank = Math.min(firstBlank, end);
    end = from + continuation.length;
    if (regions === MAX_FORMULA_REGIONS) break;

    let nextEnd = nextFormulaEnd(probe, from, continuation);
    if (nextEnd === undefined && mayCrossBlank) {
      const blank = /^\n(?:[ \t]*\n)+/.exec(probe.slice(end));
      if (blank) {
        const nextFrom = end + blank[0].length;
        const next = probe.slice(nextFrom);
        const nextParagraph = !FENCE_START.test(next) && paragraphRule.exec(next)?.[0];
        if (nextParagraph) nextEnd = nextFormulaEnd(probe, nextFrom, nextParagraph);
        if (nextEnd !== undefined) firstBlank = Math.min(firstBlank, end);
      }
    }
    if (nextEnd === undefined) break;
    end = nextEnd;
  }
  for (const range of lexRanges(probe.slice(0, end))) {
    const [from, to, linkMarkup] = range;
    if (from > start || from >= paragraph.length) break;
    // An inline literal can close before a tentative formula's other delimiter.
    if (to > start && (to <= firstBlank || linkMarkup)) return range;
  }
}

function displayMathBoundary(source, masked, paragraph, options, paragraphRule, tight) {
  const hasInlineOpener = INLINE_OPENER.test(paragraph);
  const lexRanges = (input) => literalInlineRanges(Lexer.lexInline(input, {
    ...options, tokenizer: undefined, extensions: undefined,
  }));
  let end = paragraph.length;
  let joined = false;

  // Mask only line breaks inside verified inline tokens when asking Marked
  // where the surrounding prose ends. The emitted token retains the original.
  for (let recovered = 0; recovered <= MAX_FORMULA_REGIONS; recovered++) {
    if (tight) end = tightParagraphEnd(masked, end, paragraphRule);
    const textEnd = tight ? tightTextEnd(source, masked, end, lexRanges) : end;
    const acrossBlank = hasInlineOpener
      ? /^\n(?:[ \t]*\n)+ {0,3}\$\$[ \t]*(?=\n|$)/.exec(masked.slice(end))
      : null;
    const candidates = masked.slice(0, end + (acrossBlank?.[0].length ?? 0)).matchAll(DISPLAY_MATH_LINE);
    let ranges;
    let literal;
    let continued;
    for (const { index } of candidates) {
      if (index === 0) continue;
      const formula = tokenizeDisplayMath(source.slice(index));
      if (!formula) continue;
      if (hasInlineOpener) {
        if (!ranges) {
          ranges = lexRanges(source.slice(0, end));
          literal = ranges.next().value;
        }
        while (literal && literal[1] <= index) literal = ranges.next().value;
        if (literal && literal[0] <= index && index < textEnd &&
            (!tight || !orderedChildFormula(source, literal, index, lexRanges, paragraphRule))) {
          joined ||= tight;
          continue;
        }
        if (recovered < MAX_FORMULA_REGIONS)
          continued = continueLiteral(source, source.slice(0, end), index, formula, lexRanges, paragraphRule);
        // A delimiter past an apparent sublist start is relevant only when
        // it closes a literal that already began in this text block.
        if (continued && continued[0] < textEnd &&
            (!tight || !orderedChildFormula(source, continued, index, lexRanges, paragraphRule))) break;
        continued = undefined;
      }
      if (textEnd < end && index >= textEnd) break;
      if (index < end && (!tight || joined)) return { end: index - 1, beforeFormula: true };
      if (index < end) return;
    }
    if (!continued) return joined ? { end: textEnd, masked } : undefined;
    const [start, finish] = continued;
    masked = masked.slice(0, start) + masked.slice(start, finish).replaceAll("\n", " ") + masked.slice(finish);
    end = paragraphRule.exec(masked)?.[1].replace(/\n$/, "").length ?? finish;
    joined = true;
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
    return this.inlineBlock(source, "paragraph");
  }

  text(source) {
    return this.inlineBlock(source, "text");
  }

  inlineBlock(source, type) {
    let { token, input } = this.joinAnchorEnd(source, type);
    const tight = type === "text";
    if (!token || (tight && !INLINE_OPENER.test(token.text))) return token;
    const paragraphRule = this.rules.block.paragraph;
    // Marked reads tight list text one line at a time. Inspect the whole
    // tentative paragraph before the block extension takes the next line.
    while (token) {
      const paragraph = tight ? paragraphRule.exec(input)?.[1].replace(/\n$/, "") ?? token.text : token.text;
      const boundary = displayMathBoundary(source, input, paragraph, this.options, paragraphRule, tight);
      if (!boundary) return token;

      const { end, beforeFormula, masked } = boundary;
      token.raw = source.slice(0, end + Number(!!beforeFormula));
      token.text = this.lexer.inlineQueue.at(-1).src = source.slice(0, end);
      if (beforeFormula) return token;
      const view = tight ? masked.slice(0, end).replaceAll("\n", " ") + masked.slice(end) : masked;
      // A recovered literal can expose a split end tag. Carry the same view
      // through that join and recheck the resulting block for real formulas.
      ({ token, input } = this.joinAnchorEnd(source, type, token, view));
      if (input === view) return token;
    }
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
    return { token, input };
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
