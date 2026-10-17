import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createSequence } from "@/data/terms";
import { layoutTerm, clearMeasureCache, type TermLayout } from "@/lib/term-layout";

type Box = {
  win: number;
  item: number;
  textMax: number;
  maxFont: number;
};

const SPIN_MS = 3350;
const DECAY = 2.72;

function inertia(u: number, k: number) {
  const denom = 1 - Math.exp(-k);
  return (1 - Math.exp(-k * u)) / denom;
}

function snap(px: number) {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(px * dpr) / dpr;
}

function readBox(frame: HTMLElement, itemProbe: HTMLElement, padProbe: HTMLElement): Box {
  const win = frame.clientHeight;
  const item = itemProbe.getBoundingClientRect().height || win * 0.54;
  const pad = padProbe.getBoundingClientRect().width;
  const textMax = Math.max(80, frame.clientWidth - pad * 2 - 8);
  const maxFont = Math.round(
    Math.min(92, Math.max(30, Math.min(item * 0.46, textMax / 8.2))),
  );
  return { win, item, textMax, maxFont };
}

function layoutsFor(items: readonly string[], box: Box): TermLayout[] {
  const maxHeight = box.item * 0.8;
  return items.map((term) => layoutTerm(term, box.textMax, box.maxFont, maxHeight));
}

export function Roulette() {
  const frameRef = useRef<HTMLDivElement>(null);
  const itemProbeRef = useRef<HTMLDivElement>(null);
  const padProbeRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const boxRef = useRef<Box>({ win: 320, item: 172, textMax: 760, maxFont: 64 });
  const currentRef = useRef<string | null>(null);
  const spinningRef = useRef(false);
  const itemsRef = useRef<string[]>([]);
  const allowBlurRef = useRef(true);
  const rafRef = useRef(0);

  const [spinId, setSpinId] = useState(0);
  const [phase, setPhase] = useState<"idle" | "spinning" | "settled">("idle");
  const [items, setItems] = useState<string[]>([]);
  const [layouts, setLayouts] = useState<TermLayout[]>([]);
  const [lockY, setLockY] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  itemsRef.current = items;

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const itemProbe = itemProbeRef.current;
    const padProbe = padProbeRef.current;
    if (!frame || !itemProbe || !padProbe) return boxRef.current;
    const next = readBox(frame, itemProbe, padProbe);
    boxRef.current = next;
    return next;
  }, []);

  const applyMotion = useCallback((index: number, speed: number) => {
    const strip = stripRef.current;
    const { win, item } = boxRef.current;
    if (!strip || !item) return;
    const y = (win - item) / 2 - index * item;
    strip.style.transform = `translate3d(0, ${y}px, 0)`;

    const nodes = itemRefs.current;
    const count = itemsRef.current.length;
    const start = Math.max(0, Math.floor(index) - 4);
    const end = Math.min(count - 1, Math.ceil(index) + 4);
    const allowBlur = allowBlurRef.current;

    for (let i = 0; i < count; i++) {
      const el = nodes[i];
      if (!el) continue;
      el.style.transition = "none";
      if (i < start || i > end) {
        el.style.opacity = "0";
        el.style.filter = "none";
        continue;
      }
      const distance = Math.abs(i - index);
      const opacity = Math.max(0, 1 - distance * 0.33);
      const depth = allowBlur ? Math.min(10, distance * 2.05) : 0;
      const motion = allowBlur ? Math.min(5, speed * 0.05) * Math.min(1, distance * 0.85) : 0;
      const blur = depth + motion;
      const scale = 1 - Math.min(0.065, distance * 0.026);
      el.style.opacity = opacity.toFixed(3);
      el.style.filter = blur < 0.2 ? "none" : `blur(${blur.toFixed(2)}px)`;
      el.style.transform = `scale(${scale.toFixed(4)})`;
    }
  }, []);

  const applySettled = useCallback((index: number, animate: boolean) => {
    const strip = stripRef.current;
    const { win, item } = boxRef.current;
    if (!strip || !item) return 0;
    const y = snap((win - item) / 2 - index * item);
    strip.style.transform = `translate3d(0, ${y}px, 0)`;
    const nodes = itemRefs.current;
    const count = itemsRef.current.length;
    for (let i = 0; i < count; i++) {
      const el = nodes[i];
      if (!el) continue;
      const on = Math.abs(i - index) < 0.45;
      el.style.transition = animate ? "opacity 460ms ease, filter 460ms ease, transform 460ms ease" : "none";
      el.style.opacity = on ? "1" : "0";
      el.style.filter = "none";
      el.style.transform = "scale(1)";
    }
    return y;
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const onResize = () => {
      const box = measure();
      if (spinningRef.current || itemsRef.current.length === 0) return;
      setLayouts(layoutsFor(itemsRef.current, box));
      const y = applySettled(itemsRef.current.length - 1, false);
      setLockY(y);
    };
    window.addEventListener("resize", onResize);
    const frame = frameRef.current;
    const observer = new ResizeObserver(onResize);
    if (frame) observer.observe(frame);
    document.fonts?.ready
      .then(() => {
        clearMeasureCache();
        onResize();
      })
      .catch(() => {});
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [applySettled, measure]);

  const planRef = useRef<{
    from: number;
    to: number;
    spinMs: number;
    decay: number;
    target: string;
  } | null>(null);

  const spin = useCallback(() => {
    if (spinningRef.current) return;
    const box = measure();
    const seq = createSequence(currentRef.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = seq[seq.length - 1];
    if (!target) return;
    allowBlurRef.current = !reduce;
    planRef.current = {
      from: currentRef.current ? 0 : -0.7,
      to: seq.length - 1,
      spinMs: reduce ? 520 : SPIN_MS,
      decay: reduce ? 1.2 : DECAY,
      target,
    };
    spinningRef.current = true;
    setLayouts(layoutsFor(seq, box));
    setItems(seq);
    setLockY(null);
    setPhase("spinning");
    setSpinId((id) => id + 1);
  }, [measure]);

  useLayoutEffect(() => {
    const plan = planRef.current;
    if (spinId === 0 || !plan) return;
    let alive = true;
    const { from, to, spinMs, decay, target } = plan;
    const started = performance.now();
    let lastIndex = from;
    let lastTime = started;

    const tick = (now: number) => {
      if (!alive) return;
      const u = Math.min(1, (now - started) / spinMs);
      const index = u >= 1 ? to : from + (to - from) * inertia(u, decay);
      const dt = Math.max(16, now - lastTime);
      const speed = (Math.abs(index - lastIndex) / dt) * 1000;
      lastIndex = index;
      lastTime = now;
      applyMotion(index, speed);
      if (u < 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      applyMotion(to, 0);
      rafRef.current = requestAnimationFrame(() => {
        if (!alive) return;
        const y = applySettled(to, true);
        currentRef.current = target;
        spinningRef.current = false;
        setLockY(y);
        setAnnouncement(target);
        setPhase("settled");
      });
    };

    applyMotion(from, 26);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [spinId, applyMotion, applySettled]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("a, button, input, textarea")) return;
      event.preventDefault();
      spin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spin]);

  const stripStyle =
    phase !== "spinning" && lockY != null
      ? { transform: `translate3d(0, ${lockY}px, 0)` }
      : undefined;

  return (
    <main
      className={
        phase === "spinning" ? "stage is-spinning" : phase === "settled" ? "stage is-settled" : "stage"
      }
      onPointerUp={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        spin();
      }}
    >
      <div className="frame" ref={frameRef}>
        <div className="measure-item" ref={itemProbeRef} />
        <div className="measure-pad" ref={padProbeRef} />
        <div className="reel" aria-hidden="true">
          <div className="strip" ref={stripRef} style={stripStyle}>
            {items.map((term, index) => {
              const layout = layouts[index] ?? {
                fontSize: 48,
                lineHeight: 1.08,
                lines: [term],
              };
              return (
                <div
                  key={`${term}-${index}`}
                  className="slot"
                  data-final={index === items.length - 1 ? "true" : "false"}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                >
                  <p
                    className="term"
                    style={{ fontSize: `${layout.fontSize}px`, lineHeight: layout.lineHeight }}
                  >
                    {layout.lines.map((line, lineIndex) => (
                      <span className="term-line" key={`${lineIndex}-${line}`}>
                        {line}
                      </span>
                    ))}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className={phase === "idle" ? "hint" : "hint is-hidden"} aria-hidden={phase !== "idle"}>
        PRESS SPACE
      </p>
      <p className="live" aria-live="polite">
        {announcement}
      </p>
    </main>
  );
}
