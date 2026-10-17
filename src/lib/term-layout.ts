export type TermLayout = {
  fontSize: number;
  lineHeight: number;
  lines: readonly string[];
};

let probe: HTMLSpanElement | null = null;

const widthCache = new Map<string, number>();

function measure(text: string, fontSize: number): number {
  const key = `${fontSize}\n${text}`;
  const cached = widthCache.get(key);
  if (cached != null) return cached;
  if (typeof document === "undefined") return text.length * fontSize * 0.52;
  if (!probe) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "fixed";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.whiteSpace = "nowrap";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.fontWeight = "500";
    probe.style.letterSpacing = "-0.038em";
    probe.style.fontFamily = getComputedStyle(document.body).fontFamily;
    document.body.appendChild(probe);
  }
  probe.style.fontSize = `${fontSize}px`;
  probe.textContent = text;
  const width = probe.getBoundingClientRect().width;
  widthCache.set(key, width);
  return width;
}

export function clearMeasureCache() {
  widthCache.clear();
  if (probe) probe.style.fontFamily = getComputedStyle(document.body).fontFamily;
}

function tokenize(text: string): string[] {
  const raw = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of raw) {
    const prev = out[out.length - 1];
    if ((word === "—" || word === "–" || word === "-") && prev) {
      out[out.length - 1] = `${prev} ${word}`;
    } else if (prev && (prev.endsWith("—") || prev.endsWith("–"))) {
      out[out.length - 1] = `${prev} ${word}`;
    } else {
      out.push(word);
    }
  }
  return out;
}

function fitWidth(text: string, maxWidth: number, lo: number, hi: number): number | null {
  if (hi < lo) return null;
  let best: number | null = null;
  let low = lo;
  let high = hi;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (measure(text, mid) <= maxWidth) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export function layoutTerm(
  text: string,
  maxWidth: number,
  maxFont: number,
  maxHeight: number,
): TermLayout {
  const width = Math.max(40, maxWidth);
  const fontCap = Math.max(16, Math.round(maxFont));
  const singleFloor = Math.max(18, Math.round(fontCap * 0.62));
  const single = fitWidth(text, width, Math.min(singleFloor, fontCap), fontCap);
  if (single && single * 1.08 <= maxHeight) {
    return { fontSize: single, lineHeight: 1.08, lines: [text] };
  }

  const words = tokenize(text);
  if (words.length < 2) {
    const tiny = fitWidth(text, width, 13, Math.max(13, singleFloor - 1)) ?? 13;
    return { fontSize: tiny, lineHeight: 1.08, lines: [text] };
  }

  const lineHeight = 1.12;
  const maxTwo = Math.min(Math.round(fontCap * 0.74), Math.floor(maxHeight / (lineHeight * 2)));
  let best: { size: number; lines: [string, string]; balance: number } | null = null;

  if (maxTwo >= 14) {
    for (let i = 1; i < words.length; i++) {
      const left = words.slice(0, i).join(" ");
      const right = words.slice(i).join(" ");
      let low = 14;
      let high = maxTwo;
      let ok: number | null = null;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (measure(left, mid) <= width && measure(right, mid) <= width) {
          ok = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      if (!ok) continue;
      const balance = Math.abs(left.length - right.length);
      if (!best || ok > best.size || (ok === best.size && balance < best.balance)) {
        best = { size: ok, lines: [left, right], balance };
      }
    }
  }

  if (best) {
    return { fontSize: best.size, lineHeight, lines: best.lines };
  }

  const fallback = fitWidth(text, width, 12, fontCap) ?? 12;
  return { fontSize: fallback, lineHeight: 1.08, lines: [text] };
}
