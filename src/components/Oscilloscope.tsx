// src/components/Oscilloscope.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import oscilloscopePanel from "../assets/oscilloscope-panel.png";
import "./Oscilloscope.css";

type Mode = "xy" | "wave" | "eq";
type ColorMode = "mono" | "rainbow";

/* ---------------- small UI bits ---------------- */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="osc-toggle">
      <div
        className={`osc-switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onChange(!checked);
        }}
      >
        <div className="osc-nub" />
      </div>
      <span className="osc-toggle-label">{label}</span>
    </div>
  );
}

/** Upgraded rotary with extra layers for 3D look */
function Rotary({
  label,
  min,
  max,
  step,
  value,
  onChange,
  showValue = false,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  showValue?: boolean;
}) {
  const angle = useMemo(() => {
    const t = (value - min) / (max - min);
    return -130 + t * 260;
  }, [value, min, max]);

  return (
    <div className="osc-rotary">
      <div className="osc-knob" style={{ ["--angle" as any]: `${angle}deg` }}>
        <div className="osc-knob-rim" />
        <div className="osc-knob-ticks" />
        <div className="osc-pointer" />
        <div className="osc-knob-cap" />
      </div>

      <input
        type="range"
        className="osc-range-hidden"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />

      <div className="osc-rotary-label">
        <div className="osc-rotary-name">{label}</div>
        {showValue && <div className="osc-rotary-val">{value.toFixed(2)}</div>}
      </div>
    </div>
  );
}

function Selector({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; text: string }[];
}) {
  return (
    <div className="osc-selector">
      <div className="osc-selector-label">{label}</div>
      <div className="osc-selector-row">
        {options.map((o) => (
          <button
            key={o.value}
            className={`osc-selector-btn ${o.value === value ? "active" : ""}`}
            onClick={() => onChange(o.value)}
            type="button"
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function LedBar({ level }: { level: number }) {
  const bars = 12;
  const active = Math.round(level * bars);
  return (
    <div className="osc-ledbar">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`osc-led ${i < active ? "on" : ""} ${
            i >= bars - 3 ? "hot" : ""
          }`}
        />
      ))}
    </div>
  );
}

/* ---------------- oscilloscope + EQ ---------------- */
export default function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const crtRef = useRef<HTMLDivElement | null>(null);
  const marqueeTrackRef = useRef<HTMLDivElement | null>(null);

  // audio graph
  const acRef = useRef<AudioContext | null>(null);
  const anLRef = useRef<AnalyserNode | null>(null);
  const anRRef = useRef<AnalyserNode | null>(null);
  const specRef = useRef<AnalyserNode | null>(null);
  const graphRef = useRef<{
    hpfL?: BiquadFilterNode;
    hpfR?: BiquadFilterNode;
    lpfL?: BiquadFilterNode;
    lpfR?: BiquadFilterNode;
    gain?: GainNode;
  }>({});

  // UI state
  const [power, setPower] = useState(false);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode>("xy");
  const [gain, setGain] = useState(0.7);
  const [lpf, setLpf] = useState(6000);
  const [hpf, setHpf] = useState(20);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(1);
  const [persistence, setPersistence] = useState(0.82);
  const [grid, setGrid] = useState(true);

  // appearance
  const [thickness, setThickness] = useState(2.4);
  const [glow, setGlow] = useState(8);
  const [gamma, setGamma] = useState(1.1);
  const [colorMode, setColorMode] = useState<ColorMode>("mono");
  const [monoColor, setMonoColor] = useState("#9EFFA9");
  const [soften, setSoften] = useState(0.3);

  // meters
  const [vuL, setVuL] = useState(0);
  const [vuR, setVuR] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  // EQ controls
  const [eqBands, setEqBands] = useState(32);
  const [eqSmoothing, setEqSmoothing] = useState(0.7);
  const [eqPeakHold, setEqPeakHold] = useState(true);
  const [eqMirror, setEqMirror] = useState(true);
  const eqPeaksRef = useRef<number[]>([]);

  // controls hover card visibility
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);

  // live controls cache for draw loop (IMPORTANT: RAF loop reads ONLY from here)
  const controlsRef = useRef({
    power,
    rotation,
    aspect,
    persistence,
    thickness,
    glow,
    gamma,
    colorMode,
    monoColor,
    grid,
    mode,
    soften,
    eqBands,
    eqSmoothing,
    eqPeakHold,
    eqMirror,
  });

  // keep ref fresh every render
  Object.assign(controlsRef.current, {
    power,
    rotation,
    aspect,
    persistence,
    thickness,
    glow,
    gamma,
    colorMode,
    monoColor,
    grid,
    mode,
    soften,
    eqBands,
    eqSmoothing,
    eqPeakHold,
    eqMirror,
  });

  // render loop refs (IMPORTANT: single loop only)
  const rafRef = useRef<number | null>(null);
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });

  // hi-dpi offscreen buffer
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const offCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (running) return;
    setRunning(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // @ts-ignore
          systemAudio: "include",
        },
        video: true,
      });
      stream.getVideoTracks().forEach((t) => t.stop());
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    const ac = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 48000,
    });
    acRef.current = ac;

    const src = ac.createMediaStreamSource(stream);
    const split = ac.createChannelSplitter(2);

    const hpfL = ac.createBiquadFilter();
    hpfL.type = "highpass";
    hpfL.frequency.value = hpf;

    const hpfR = ac.createBiquadFilter();
    hpfR.type = "highpass";
    hpfR.frequency.value = hpf;

    const lpfL = ac.createBiquadFilter();
    lpfL.type = "lowpass";
    lpfL.frequency.value = lpf;

    const lpfR = ac.createBiquadFilter();
    lpfR.type = "lowpass";
    lpfR.frequency.value = lpf;

    const gainNode = ac.createGain();
    gainNode.gain.value = gain;

    const anL = ac.createAnalyser();
    const anR = ac.createAnalyser();
    anL.fftSize = anR.fftSize = 2048;

    src.connect(split);
    split.connect(hpfL, 0);
    split.connect(hpfR, 1);
    hpfL.connect(lpfL);
    hpfR.connect(lpfR);
    lpfL.connect(gainNode);
    lpfR.connect(gainNode);

    // scope analysers (post-gain)
    lpfL.connect(anL);
    lpfR.connect(anR);

    // spectrum analyser for EQ
    const spec = ac.createAnalyser();
    spec.fftSize = 2048;
    spec.smoothingTimeConstant = eqSmoothing;
    lpfL.connect(spec);
    lpfR.connect(spec);
    specRef.current = spec;

    anLRef.current = anL;
    anRRef.current = anR;
    graphRef.current = { hpfL, hpfR, lpfL, lpfR, gain: gainNode };

    // ensure loop is running + canvas sized
    resizeCanvas();
    ensureRenderLoop();
    meterLoop();
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    try {
      acRef.current?.close();
    } catch {}
    acRef.current = null;
    setRunning(false);
  }

  useEffect(() => {
    if (power && !running) start();
    if (!power && running) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [power]);

  // live node updates
  useEffect(() => {
    const ac = acRef.current;
    if (!ac) return;
    graphRef.current.hpfL?.frequency.setTargetAtTime(hpf, ac.currentTime, 0.02);
    graphRef.current.hpfR?.frequency.setTargetAtTime(hpf, ac.currentTime, 0.02);
    graphRef.current.lpfL?.frequency.setTargetAtTime(lpf, ac.currentTime, 0.02);
    graphRef.current.lpfR?.frequency.setTargetAtTime(lpf, ac.currentTime, 0.02);
    graphRef.current.gain?.gain.setTargetAtTime(gain, ac.currentTime, 0.02);
  }, [hpf, lpf, gain]);

  useEffect(() => {
    if (specRef.current) specRef.current.smoothingTimeConstant = eqSmoothing;
  }, [eqSmoothing]);

  // fullscreen & resize
  useEffect(() => {
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement);
      requestAnimationFrame(() => resizeCanvas());
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ResizeObserver
  useEffect(() => {
    const host = crtRef.current;
    const cvs = canvasRef.current;
    if (!host || !cvs) return;

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => resizeCanvas());
    });

    ro.observe(host);
    ro.observe(cvs);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  function toggleFullscreen() {
    const el = crtRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      // @ts-ignore
      el.requestFullscreen?.({ navigationUI: "hide" }).catch(() =>
        // @ts-ignore
        el.requestFullscreen?.()
      );
    } else {
      document.exitFullscreen?.();
    }
  }

  /* ---------------- drawing helpers ---------------- */
  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.save();
    ctx.strokeStyle = "rgba(150,160,180,.22)";
    ctx.lineWidth = 1;
    const n = 10,
      dx = w / n,
      dy = h / n;
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * dx, 0);
      ctx.lineTo(i * dx, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * dy);
      ctx.lineTo(w, i * dy);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(200,220,250,.5)";
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.restore();
  }

  function hueForLevel(yNorm: number) {
    const hue = 170 - 170 * yNorm; // teal->green->yellow->red
    return `hsl(${hue}, 90%, 65%)`;
  }

  function drawEQ(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const spec = specRef.current;
    if (!spec) return;

    const { eqBands, eqPeakHold, eqMirror } = controlsRef.current;

    const binCount = spec.frequencyBinCount;
    const data = new Uint8Array(binCount);
    spec.getByteFrequencyData(data);

    const cols = Math.max(8, Math.min(96, eqBands));
    let values: number[] = [];

    if (eqMirror) {
      const half = Math.max(1, Math.floor(cols / 2));
      const groupSize = Math.max(1, Math.floor(binCount / half));

      const baseValues: number[] = [];
      for (let c = 0; c < half; c++) {
        const start = c * groupSize;
        let sum = 0;
        let count = 0;

        for (let i = 0; i < groupSize && start + i < binCount; i++) {
          sum += data[start + i];
          count++;
        }

        const v = count ? sum / (count * 255) : 0;
        baseValues[c] = Math.pow(v, 0.85);
      }

      values = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const mirroredIndex = c < half ? c : cols - 1 - c;
        const idx = Math.min(half - 1, mirroredIndex);
        values[c] = baseValues[idx];
      }
    } else {
      const groupSize = Math.max(1, Math.floor(binCount / cols));
      values = new Array(cols);

      for (let c = 0; c < cols; c++) {
        const start = c * groupSize;
        let sum = 0;
        let count = 0;

        for (let i = 0; i < groupSize && start + i < binCount; i++) {
          sum += data[start + i];
          count++;
        }

        const v = count ? sum / (count * 255) : 0;
        values[c] = Math.pow(v, 0.85);
      }
    }

    if (eqPeaksRef.current.length !== cols) {
      eqPeaksRef.current = Array(cols).fill(0);
    }

    const gap = Math.max(1, Math.floor(w / cols / 10));
    const colW = (w - (cols + 1) * gap) / cols;
    const segH = Math.max(4, Math.floor(h / 40));
    const segments = Math.floor(h / segH);

    ctx.save();

    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "rgba(255,255,255,0.03)");
    grd.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    for (let c = 0; c < cols; c++) {
      const x = gap + c * (colW + gap);
      const levelSegs = Math.floor(values[c] * segments);

      for (let s = 0; s < levelSegs; s++) {
        const yBottom = h - (s + 1) * segH;
        const yNorm = (s + 1) / segments;
        ctx.fillStyle = hueForLevel(yNorm);
        ctx.fillRect(x, yBottom + 1, colW, segH - 2);
      }

      if (eqPeakHold) {
        const decay = 0.015;
        eqPeaksRef.current[c] = Math.max(eqPeaksRef.current[c] - decay, values[c]);
        const peakY = h - Math.floor(eqPeaksRef.current[c] * segments) * segH;
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.fillRect(x, Math.max(0, peakY - 2), colW, 2);
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    ctx.restore();
  }

  function strokeSmoothPath(
    ctx: CanvasRenderingContext2D,
    xs: number[],
    ys: number[],
    s: number
  ) {
    const n = xs.length;
    if (n === 0) return;
    if (n < 3 || s <= 0) {
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
      return;
    }

    let x0 = xs[0],
      y0 = ys[0];
    let x1 = xs[1],
      y1 = ys[1];
    let mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    ctx.moveTo(mx, my);

    for (let i = 1; i < n - 1; i++) {
      const x = xs[i],
        y = ys[i];
      const nx = xs[i + 1],
        ny = ys[i + 1];
      const midx = (x + nx) / 2,
        midy = (y + ny) / 2;

      const cx = x + (midx - x) * s;
      const cy = y + (midy - y) * s;

      ctx.quadraticCurveTo(cx, cy, midx, midy);
    }

    ctx.lineTo(xs[n - 1], ys[n - 1]);
  }

  function resizeCanvas() {
    const cvs = canvasRef.current;
    if (!cvs) return;

    const rect = cvs.getBoundingClientRect();
    const cssW = Math.max(200, Math.floor(rect.width));
    const cssH = Math.max(150, Math.floor(rect.height));

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    dprRef.current = dpr;
    sizeRef.current = { w: cssW, h: cssH };

    cvs.width = Math.floor(cssW * dpr);
    cvs.height = Math.floor(cssH * dpr);

    if (!offRef.current) offRef.current = document.createElement("canvas");
    const off = offRef.current;
    off.width = Math.floor(cssW * dpr);
    off.height = Math.floor(cssH * dpr);

    offCtxRef.current = off.getContext("2d");
    if (offCtxRef.current) {
      offCtxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function ensureRenderLoop() {
    if (rafRef.current) return;

    const loop = () => {
      renderFrame();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }

  function renderFrame() {
    const cvs = canvasRef.current;
    const off = offRef.current;
    const octx = offCtxRef.current;
    if (!cvs || !off || !octx) return;

    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const { w: cssW, h: cssH } = sizeRef.current;
    const dpr = dprRef.current;

    // IMPORTANT: read power from ref (avoids stale closure)
    const {
      power: powered,
      rotation,
      aspect,
      persistence,
      thickness,
      glow,
      gamma,
      colorMode,
      monoColor,
      grid,
      mode: curMode,
      soften,
    } = controlsRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const fade = Math.pow(1 - persistence, gamma);
    ctx.fillStyle = `rgba(2,5,12,${fade})`;
    ctx.fillRect(0, 0, cssW, cssH);

    if (!powered || !anLRef.current || !anRRef.current) {
      ctx.fillStyle = "rgba(2,5,12,.9)";
      ctx.fillRect(0, 0, cssW, cssH);
      return;
    }

    if (grid && curMode !== "eq") drawGrid(ctx, cssW, cssH);

    if (curMode === "eq") {
      drawEQ(ctx, cssW, cssH);
      return;
    }

    const anL = anLRef.current;
    const anR = anRRef.current;

    const N = anL.fftSize;
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    anL.getFloatTimeDomainData(L);
    anR.getFloatTimeDomainData(R);

    octx.clearRect(0, 0, cssW, cssH);

    const setStroke = (t: CanvasRenderingContext2D, a = 1) => {
      t.lineCap = "round";
      t.lineJoin = "round";
      t.globalAlpha = a;
      t.lineWidth = thickness;
    };

    setStroke(octx, 1);
    const smooth = Math.min(Math.max(soften, 0), 1);

    if (curMode === "wave") {
      const xs: number[] = new Array(N);
      const ys: number[] = new Array(N);
      for (let i = 0; i < N; i++) {
        xs[i] = (i / N) * cssW;
        ys[i] = cssH * 0.5 - L[i] * (cssH * 0.45);
      }
      octx.beginPath();
      strokeSmoothPath(octx, xs, ys, smooth);
      octx.strokeStyle = monoColor;
      octx.stroke();
    } else {
      const cx = cssW / 2;
      const cy = cssH / 2;
      const scale = 0.47 * Math.min(cssW, cssH);
      const rot = (rotation * Math.PI) / 180;
      const c = Math.cos(rot);
      const s = Math.sin(rot);

      if (colorMode === "mono") {
        const xs: number[] = new Array(N);
        const ys: number[] = new Array(N);
        for (let i = 0; i < N; i++) {
          const xr = L[i] * c - R[i] * s;
          const yr = (L[i] * s + R[i] * c) * aspect;
          xs[i] = cx + xr * scale;
          ys[i] = cy - yr * scale;
        }
        octx.beginPath();
        strokeSmoothPath(octx, xs, ys, smooth);
        octx.strokeStyle = monoColor;
        octx.stroke();
      } else {
        const seg = 64;
        for (let k = 0; k < N - seg; k += seg) {
          const xs: number[] = new Array(seg);
          const ys: number[] = new Array(seg);
          for (let i = 0; i < seg; i++) {
            const j = k + i;
            const xr = L[j] * c - R[j] * s;
            const yr = (L[j] * s + R[j] * c) * aspect;
            xs[i] = cx + xr * scale;
            ys[i] = cy - yr * scale;
          }
          octx.beginPath();
          strokeSmoothPath(octx, xs, ys, smooth);
          const hue = ((360 * k) / N) | 0;
          octx.strokeStyle = `hsl(${hue} 90% 70%)`;
          octx.stroke();
        }
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    if (glow > 0) {
      ctx.filter = `blur(${glow}px)`;
      ctx.drawImage(off, 0, 0, off.width / dpr, off.height / dpr);
      ctx.filter = "none";
    }

    setStroke(ctx, 1);
    ctx.drawImage(off, 0, 0, off.width / dpr, off.height / dpr);

    ctx.restore();
  }

  function meterLoop() {
    const anL = anLRef.current;
    const anR = anRRef.current;
    if (!anL || !anR) return;

    const N = 512;
    const l = new Float32Array(N);
    const r = new Float32Array(N);

    const tick = () => {
      if (!controlsRef.current.power) {
        setVuL(0);
        setVuR(0);
        requestAnimationFrame(tick);
        return;
      }

      anL.getFloatTimeDomainData(l);
      anR.getFloatTimeDomainData(r);

      const rms = (b: Float32Array) =>
        Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);

      setVuL(Math.min(1, rms(l) * 2.2));
      setVuR(Math.min(1, rms(r) * 2.2));

      requestAnimationFrame(tick);
    };

    tick();
  }
   
   // NOW PLAYING (from extension via window.postMessage)
  const [nowPlaying, setNowPlaying] = useState<string>("Waiting for playback…");
  const [nowPlayingSource, setNowPlayingSource] = useState<string>("");

  const lastNpRef = useRef<string>("");

  function setNp(text: string, source?: string) {
    const t = String(text || "").trim();
    if (!t) return;
    if (t === lastNpRef.current) return;
    lastNpRef.current = t;
    setNowPlaying(t);
    setNowPlayingSource(source ? String(source) : "");
  }

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      console.log("[OSC] message", ev.data);
      const data: any = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "OSC_NOW_PLAYING") return;

      if (typeof data.text === "string" && data.text.trim()) {
        setNp(data.text, data.source);
      }
    };

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Measure 1 copy width + gap, then animate by pixels (seamless for 2 copies)
useEffect(() => {
  const track = marqueeTrackRef.current;
  if (!track) return;

  const apply = () => {
  const items = track.querySelectorAll(".osc-nowplaying-item");
  const first = items[0] as HTMLElement | undefined;
  const second = items[1] as HTMLElement | undefined;
  if (!first || !second) return;

  const mask = track.parentElement as HTMLElement | null;
  const maskWidth = Math.round(mask?.clientWidth ?? 0);

  const rightPadding = 18;

  // start: right-aligned inside the mask
  const start = Math.max(
    0,
    Math.round(maskWidth - first.offsetWidth - rightPadding)
  );

  // stride between copies (includes your margin-left gap)
  const stride = Math.max(1, Math.round(second.offsetLeft - first.offsetLeft));

  // travel must include the start offset so it reaches the left before looping
  const travel = start + stride;

  const pxPerSec = 90;
  const seconds = Math.max(10, Math.min(40, travel / pxPerSec));

  track.style.setProperty("--marqueeStart", `${start}px`);
  track.style.setProperty("--marqueeDistance", `${travel}px`);
  track.style.setProperty("--marqueeSeconds", `${seconds}s`);

  track.style.animation = "none";
  track.getBoundingClientRect();
  track.style.animation = `osc-marquee var(--marqueeSeconds) linear infinite`;
};

  apply();
  const t = window.setTimeout(apply, 150); 
  window.addEventListener("resize", apply);

  return () => {
    window.clearTimeout(t);
    window.removeEventListener("resize", apply);
  };
}, [nowPlaying, nowPlayingSource, power]);

  // hover card show/hide
  function showControls() {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setControlsVisible(true);
  }

  function hideControls() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 140);
  }

  // start loop + initial sizing once on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      resizeCanvas();
      ensureRenderLoop();
    });

    const onWinResize = () => resizeCanvas();
    window.addEventListener("resize", onWinResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onWinResize);
    };
  }, []);

  return (
    <div className="osc-chassis">
      <div className="osc-stage">
        <div className="osc-crt-wrap">
          <img className="osc-panel-image" src={oscilloscopePanel} alt="" aria-hidden="true" />
          <div className={`osc-crt ${power ? "glow" : ""}`} ref={crtRef}>
  {/* NOW PLAYING marquee overlay */}
  <div className={`osc-nowplaying ${power ? "" : "off"}`} aria-label="Now playing marquee">
    <div className="osc-nowplaying-mask">
      <div className="osc-nowplaying-track" ref={marqueeTrackRef}>
  {Array.from({ length: 8 }).map((_, i) => (
    <span
      key={i}
      className="osc-nowplaying-item"
      aria-hidden={i === 0 ? undefined : true}
    >
      <span className="osc-nowplaying-tag">NOW PLAYING</span>
      <span className="osc-nowplaying-text">{nowPlaying}</span>
      {nowPlayingSource ? (
        <span className="osc-nowplaying-src">{nowPlayingSource}</span>
      ) : null}
    </span>
  ))}
</div>
    </div>
  </div>

  <canvas ref={canvasRef} className="osc-canvas" />
  <button
    className="osc-icon-fs"
    onClick={toggleFullscreen}
    aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    type="button"
  >
    {fullscreen ? <Minimize2 /> : <Maximize2 />}
  </button>
</div>

          <div className="osc-brand">
            {mode === "eq" ? "graphic equalizer" : "vector scope display"}
          </div>

          <button
            className="osc-controls-tab"
            onMouseEnter={showControls}
            onFocus={showControls}
            onMouseLeave={hideControls}
            onBlur={hideControls}
            aria-label="Controls"
            title="Controls"
            type="button"
          >
            Controls
          </button>

          <div
            className={`osc-controls-card ${controlsVisible ? "" : "dimmed"}`}
            onMouseEnter={showControls}
            onMouseLeave={hideControls}
            onFocus={showControls}
            onBlur={hideControls}
            role="region"
            aria-label="Oscilloscope controls"
          >
            <div className="osc-logo">NEATS 0630KNM</div>

            <div className="osc-group">
              <div className="osc-group-title">Power</div>

              <div className="osc-row">
                <div className="osc-toggle">
                  <div
                    className={`osc-switch ${power ? "on" : ""}`}
                    onClick={() => setPower((p) => !p)}
                    role="switch"
                    aria-checked={power}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setPower((p) => !p);
                    }}
                  >
                    <div className="osc-nub" />
                  </div>
                  <span className="osc-toggle-label">{power ? "ON" : "OFF"}</span>
                </div>

                <div className="osc-meters">
                  <LedBar level={vuL} />
                  <LedBar level={vuR} />
                </div>
              </div>
            </div>

            <div className="osc-group">
              <div className="osc-group-title">Mode / Grid</div>

              <div className="osc-row osc-row-wrap">
                <Selector
                  label="Display"
                  value={mode}
                  onChange={(v) => setMode(v as Mode)}
                  options={[
                    { value: "xy", text: "X-Y" },
                    { value: "wave", text: "Time" },
                    { value: "eq", text: "EQ" },
                  ]}
                />
                <Toggle label="Grid" checked={grid} onChange={setGrid} />
              </div>

              {mode === "eq" && (
                <div className="osc-eq-row">
                  <Selector
                    label="Bands"
                    value={String(eqBands)}
                    onChange={(v) => setEqBands(parseInt(v, 10))}
                    options={[
                      { value: "16", text: "16" },
                      { value: "32", text: "32" },
                      { value: "48", text: "48" },
                      { value: "64", text: "64" },
                    ]}
                  />

                  <Selector
                    label="Peaks"
                    value={eqPeakHold ? "on" : "off"}
                    onChange={(v) => setEqPeakHold(v === "on")}
                    options={[
                      { value: "on", text: "Hold" },
                      { value: "off", text: "Off" },
                    ]}
                  />

                  <div className="osc-smoothing">
                    <span className="osc-smoothing-label">Smoothing</span>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={eqSmoothing}
                      onChange={(e) => setEqSmoothing(+e.target.value)}
                      className="osc-smoothing-range"
                    />
                  </div>

                  <Toggle label="Mirror" checked={eqMirror} onChange={setEqMirror} />
                </div>
              )}
            </div>

            <div className="osc-group">
              <div className="osc-group-title">Geometry</div>
              <div className="osc-knob-grid osc-knob-grid-3">
                <Rotary label="Rotate" min={-180} max={180} step={1} value={rotation} onChange={setRotation} />
                <Rotary label="Aspect" min={0.4} max={2} step={0.01} value={aspect} onChange={setAspect} showValue />
                <Rotary label="Gain" min={0} max={2} step={0.01} value={gain} onChange={setGain} showValue />
              </div>
            </div>

            <div className="osc-group">
              <div className="osc-group-title">Filters</div>
              <div className="osc-knob-grid osc-knob-grid-3">
                <Rotary label="HPF Hz" min={5} max={200} step={1} value={hpf} onChange={setHpf} />
                <Rotary label="LPF Hz" min={200} max={20000} step={10} value={lpf} onChange={setLpf} />
                <Rotary label="Persist" min={0} max={0.98} step={0.01} value={persistence} onChange={setPersistence} showValue />
              </div>
            </div>

            <div className="osc-group">
              <div className="osc-group-title">Phosphor</div>

              <div className="osc-knob-grid osc-knob-grid-4">
                <Rotary label="Thickness" min={0.6} max={6} step={0.1} value={thickness} onChange={setThickness} />
                <Rotary label="Glow" min={0} max={16} step={1} value={glow} onChange={setGlow} />
                <Rotary label="Gamma" min={0.8} max={1.6} step={0.01} value={gamma} onChange={setGamma} />
                <Rotary label="Soften" min={0} max={1} step={0.01} value={soften} onChange={setSoften} showValue />
              </div>

              <div className="osc-phosphor-row">
                <Selector
                  label="Color"
                  value={colorMode}
                  onChange={(v) => setColorMode(v as ColorMode)}
                  options={[
                    { value: "mono", text: "Mono" },
                    { value: "rainbow", text: "Rainbow" },
                  ]}
                />

                {colorMode === "mono" && (
                  <div className="osc-colorpick">
                    <div className="osc-swatch" style={{ background: monoColor }} />
                    <input
                      type="color"
                      value={monoColor}
                      onChange={(e) => setMonoColor(e.target.value)}
                      className="osc-color-input"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
