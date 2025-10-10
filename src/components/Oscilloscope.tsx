// src/components/Oscilloscope.tsx
import { useEffect, useMemo, useRef, useState } from "react";

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
    <div className="toggle">
      <div className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
        <div className="nub" />
      </div>
      <span className="label">{label}</span>
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
    <div className="rotary">
      <div className="knob" style={{ transform: `rotate(${angle}deg)` }}>
        {/* decorative layers */}
        <div className="knob-rim" />
        <div className="knob-ticks" />
        <div className="pointer" />
        <div className="knob-cap" />
      </div>
      <input
        type="range"
        className="range-hidden"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
      <div className="rotary-label">
        <div className="name">{label}</div>
        {showValue && <div className="val">{value.toFixed(2)}</div>}
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
    <div className="selector">
      <div className="selector-label">{label}</div>
      <div className="selector-row">
        {options.map((o) => (
          <button
            key={o.value}
            className={`selector-btn ${o.value === value ? "active" : ""}`}
            onClick={() => onChange(o.value)}
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
    <div className="ledbar">
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} className={`led ${i < active ? "on" : ""} ${i >= bars - 3 ? "hot" : ""}`} />
      ))}
    </div>
  );
}

/* ---------------- oscilloscope + EQ ---------------- */
export default function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const crtRef = useRef<HTMLDivElement | null>(null);

  // audio graph
  const acRef = useRef<AudioContext | null>(null);
  const anLRef = useRef<AnalyserNode | null>(null);
  const anRRef = useRef<AnalyserNode | null>(null);
  const specRef = useRef<AnalyserNode | null>(null); // <- spectrum for EQ
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

  // meters
  const [vuL, setVuL] = useState(0);
  const [vuR, setVuR] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  // EQ controls
  const [eqBands, setEqBands] = useState(32); // number of columns
  const [eqSmoothing, setEqSmoothing] = useState(0.7); // analyser smoothing
  const [eqPeakHold, setEqPeakHold] = useState(true);

  // peak memory for EQ (decays)
  const eqPeaksRef = useRef<number[]>([]);

  // live controls cache
  const controlsRef = useRef({
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
  });
  Object.assign(controlsRef.current, {
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
  });

  useEffect(() => () => stop(), []);

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

    // spectrum analyser for EQ (sum both branches into same analyser input)
    const spec = ac.createAnalyser();
    spec.fftSize = 2048;
    spec.smoothingTimeConstant = eqSmoothing;
    lpfL.connect(spec);
    lpfR.connect(spec);
    specRef.current = spec;

    // IMPORTANT: Do NOT route to speakers. Chrome may mute captured audio
    // in Window/Screen capture if we create a feedback path.
    // If you want monitoring later, gate connects behind a user toggle.
    // const out = ac.createChannelMerger(2);
    // lpfL.connect(out, 0, 0);
    // lpfR.connect(out, 0, 1);
    // out.connect(ac.destination);

    anLRef.current = anL;
    anRRef.current = anR;
    graphRef.current = { hpfL, hpfR, lpfL, lpfR, gain: gainNode };

    draw();
    meterLoop();
  }

  function stop() {
    try {
      acRef.current?.close();
    } catch {}
    acRef.current = null;
    setRunning(false);
  }

  // power behaviour
  useEffect(() => {
    if (power && !running) start();
    if (!power && running) stop();
  }, [power]); // eslint-disable-line

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

  // analyser smoothing for EQ
  useEffect(() => {
    if (specRef.current) specRef.current.smoothingTimeConstant = eqSmoothing;
  }, [eqSmoothing]);

  // fullscreen change -> reflect state & redraw
  useEffect(() => {
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement);
      draw();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ResizeObserver keeps canvas sized to its box (incl. fullscreen)
  useEffect(() => {
    const host = crtRef.current;
    if (!host) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(host);
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
      el.requestFullscreen?.({ navigationUI: "hide" }).catch(() => el.requestFullscreen?.());
    } else {
      document.exitFullscreen?.();
    }
  }

  /* drawing helpers */
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
    // 0 at bottom (cool) -> 1 at top (hot)
    const hue = 170 - 170 * yNorm; // teal->green->yellow->red (~170..0)
    return `hsl(${hue}, 90%, 65%)`;
  }

  function drawEQ(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const spec = specRef.current;
    if (!spec) return;

    const binCount = spec.frequencyBinCount; // 1024 (fftSize/2)
    const data = new Uint8Array(binCount);
    spec.getByteFrequencyData(data);

    // number of columns
    const cols = Math.max(8, Math.min(96, eqBands));
    const groupSize = Math.floor(binCount / cols);

    // compute per-column value (log-ish emphasis)
    const values: number[] = [];
    for (let c = 0; c < cols; c++) {
      const start = c * groupSize;
      let sum = 0;
      for (let i = 0; i < groupSize; i++) sum += data[start + i];
      const v = sum / (groupSize * 255); // 0..1
      values.push(Math.pow(v, 0.85)); // slight companding for punch
    }

    // init peaks array if needed
    if (eqPeaksRef.current.length !== cols) {
      eqPeaksRef.current = Array(cols).fill(0);
    }

    const gap = Math.max(1, Math.floor(w / cols / 10)); // visual gap
    const colW = (w - (cols + 1) * gap) / cols;
    const segH = Math.max(4, Math.floor(h / 40)); // height of a segment block
    const segments = Math.floor(h / segH);

    ctx.save();
    // base glass
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "rgba(255,255,255,0.03)");
    grd.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    for (let c = 0; c < cols; c++) {
      const x = gap + c * (colW + gap);
      const levelSegs = Math.floor(values[c] * segments);

      // draw segments from bottom
      for (let s = 0; s < levelSegs; s++) {
        const yBottom = h - (s + 1) * segH;
        const yNorm = (s + 1) / segments;
        ctx.fillStyle = hueForLevel(yNorm);
        ctx.fillRect(x, yBottom + 1, colW, segH - 2);
      }

      // peak hold marker
      if (eqPeakHold) {
        const decay = 0.015; // fall speed per frame
        eqPeaksRef.current[c] = Math.max(eqPeaksRef.current[c] - decay, values[c]);
        const peakY = h - Math.floor(eqPeaksRef.current[c] * segments) * segH;
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.fillRect(x, Math.max(0, peakY - 2), colW, 2);
      }
    }

    // inner border/gloss
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.restore();
  }

  function draw() {
    const cvs = canvasRef.current!;
    if (!cvs) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = cvs.getBoundingClientRect(); // robust across fullscreen transitions
    const cssW = Math.max(200, Math.floor(rect.width));
    const cssH = Math.max(150, Math.floor(rect.height));
    cvs.width = Math.floor(cssW * dpr);
    cvs.height = Math.floor(cssH * dpr);

    const ctx = cvs.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const off = document.createElement("canvas");
    off.width = cssW;
    off.height = cssH;
    const octx = off.getContext("2d")!;

    const loop = () => {
      const { rotation, aspect, persistence, thickness, glow, gamma, colorMode, monoColor, grid, mode: curMode } =
        controlsRef.current;

      if (!power || !anLRef.current || !anRRef.current) {
        ctx.fillStyle = "rgba(2,5,12,.9)";
        ctx.fillRect(0, 0, cssW, cssH);
        requestAnimationFrame(loop);
        return;
      }

      // background fade
      const fade = Math.pow(1 - persistence, gamma);
      ctx.fillStyle = `rgba(2,5,12,${fade})`;
      ctx.fillRect(0, 0, cssW, cssH);
      if (grid && curMode !== "eq") drawGrid(ctx, cssW, cssH);

      if (curMode === "eq") {
        drawEQ(ctx, cssW, cssH);
        requestAnimationFrame(loop);
        return;
      }

      // scope drawing (wave/xy)
      const anL = anLRef.current,
        anR = anRRef.current;
      const N = anL.fftSize;
      const L = new Float32Array(N),
        R = new Float32Array(N);
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

      const drawSeg = (i: number, x: number, y: number) => {
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      };

      octx.beginPath();
      if (curMode === "wave") {
        for (let i = 0; i < N; i++) {
          const x = (i / N) * cssW;
          const y = cssH * 0.5 - L[i] * (cssH * 0.45);
          drawSeg(i, x, y);
        }
        octx.strokeStyle = monoColor;
        octx.stroke();
      } else {
        const cx = cssW / 2,
          cy = cssH / 2,
          scale = 0.47 * Math.min(cssW, cssH);
        const rot = (rotation * Math.PI) / 180,
          c = Math.cos(rot),
          s = Math.sin(rot);

        if (colorMode === "mono") {
          for (let i = 0; i < N; i++) {
            const xr = L[i] * c - R[i] * s;
            const yr = (L[i] * s + R[i] * c) * aspect;
            drawSeg(i, cx + xr * scale, cy - yr * scale);
          }
          octx.strokeStyle = monoColor;
          octx.stroke();
        } else {
          const seg = 64;
          for (let k = 0; k < N - seg; k += seg) {
            octx.beginPath();
            for (let i = 0; i < seg; i++) {
              const j = k + i;
              const xr = L[j] * c - R[j] * s;
              const yr = (L[j] * s + R[j] * c) * aspect;
              drawSeg(i, cx + xr * scale, cy - yr * scale);
            }
            const hue = ((360 * k) / N) | 0;
            octx.strokeStyle = `hsl(${hue} 90% 70%)`;
            octx.stroke();
          }
        }
      }

      // glow pass
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      if (glow > 0) {
        ctx.filter = `blur(${glow}px)`;
        ctx.drawImage(off, 0, 0);
        ctx.filter = "none";
      }
      setStroke(ctx, 1);
      ctx.drawImage(off, 0, 0);
      ctx.restore();

      requestAnimationFrame(loop);
    };

    loop();
  }

  // meters
  function meterLoop() {
    const anL = anLRef.current,
      anR = anRRef.current;
    if (!anL || !anR) return;
    const N = 512,
      l = new Float32Array(N),
      r = new Float32Array(N);
    const tick = () => {
      if (!power) {
        setVuL(0);
        setVuR(0);
        requestAnimationFrame(tick);
        return;
      }
      anL.getFloatTimeDomainData(l);
      anR.getFloatTimeDomainData(r);
      const rms = (b: Float32Array) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
      setVuL(Math.min(1, rms(l) * 2.2));
      setVuR(Math.min(1, rms(r) * 2.2));
      requestAnimationFrame(tick);
    };
    tick();
  }

  return (
    <div className="chassis">
      <style>{`
        .chassis{
          --panel:#1b222d; --bezel:#0e131a; --text:#eaf2ff; --accent:#9EFFA9; --trim:#2b3442;
          --knob-size: clamp(56px, 7vw, 74px);
          color:var(--text); background:linear-gradient(#151922,#0c1117);
          padding:clamp(8px,1vw,16px); width:100vw; height:100vh; box-sizing:border-box;
          display:flex; align-items:center; justify-content:center;
        }
        .panel{
          display:grid; grid-template-columns: 1fr 0.88fr;
          gap:clamp(10px,1.2vw,22px); width:95vw; height:90vh; max-width:1640px;
          filter: drop-shadow(0 10px 30px rgba(0,0,0,.45));
        }

        .crt-wrap{
          position:relative;
          background: linear-gradient(#0e141c,#0b0f16);
          border-radius:12px; padding:clamp(12px,1.2vw,18px);
          box-shadow: inset 0 0 0 2px #222c3a, inset 0 8px 18px rgba(255,255,255,.04);
          display:flex; flex-direction:column; height:100%;
        }
        .crt{
          position:relative; flex:1; border-radius:10px; overflow:hidden;
          background:#02050c;
          box-shadow: inset 0 0 0 1px #16202e, 0 14px 34px rgba(0,0,0,.45);
        }
        /* Fullscreen: let the CRT truly fill the screen */
        .crt:fullscreen {
          width: 100vw !important;
          height: 100vh !important;
          border-radius: 0 !important;
          padding: 0 !important;
          background: #02050c;
          box-shadow: none;
        }
        .crt:fullscreen canvas{
          width: 100vw !important;
          height: 100vh !important;
          display:block;
        }
        .crt:fullscreen + .brand{ display:none; }

        .crt::before{
          content:""; position:absolute; inset:0; pointer-events:none;
          background:
            radial-gradient(120% 120% at 50% 50%, transparent 55%, rgba(0,0,0,.35) 85%),
            linear-gradient(105deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.02) 25%, transparent 40%);
          mix-blend-mode:screen;
        }
        .crt::after{
          content:""; position:absolute; inset:0; pointer-events:none; opacity:.06;
          background:
            radial-gradient(ellipse at center, rgba(255,255,255,.06), rgba(0,0,0,0) 60%) 0 0/3px 3px,
            radial-gradient(ellipse at center, rgba(0,0,0,.06), rgba(0,0,0,0) 60%) 1px 2px/4px 4px;
        }
        .crt canvas{ width:100%; height:100%; display:block; }
        .brand{ font-size:11px; opacity:.55; letter-spacing:.18em; text-transform:uppercase; margin-top:6px; }

        .side{
          background: linear-gradient(#1c2431,#17202c);
          border-radius:12px; padding:12px;
          box-shadow: inset 0 0 0 1px #2a3240, inset 0 18px 26px rgba(255,255,255,.03);
          display:grid; grid-template-rows:auto auto auto auto 1fr; gap:12px; height:100%; min-height:0;
        }
        .logo{ font-weight:700; letter-spacing:.08em; opacity:.9; font-size:14px; text-shadow:0 1px 0 #000; }

        .group{
          border-radius:10px; padding:12px;
          background: linear-gradient(180deg, #1a2230 0%, #171f2b 100%);
          box-shadow: inset 0 0 0 1px #2b3442, inset 0 18px 22px rgba(255,255,255,.03), inset 0 -8px 18px rgba(0,0,0,.25);
        }
        .group-title{ font-size:12px; text-transform:uppercase; letter-spacing:.1em; opacity:.7; margin-bottom:8px; }

        .row{ display:flex; gap:10px; align-items:center; }
        .meters{ display:flex; gap:6px; align-items:center; margin-left:auto; }
        .full-btn{
          padding:6px 10px; border-radius:8px; border:1px solid #2b3442; cursor:pointer;
          background:#131a22; color:#cfe4ff; box-shadow:inset 0 0 0 1px #2b3442; font-weight:700; letter-spacing:.06em;
        }

        .toggle{ display:flex; align-items:center; gap:10px; }
        .switch{ width:48px; height:24px; border-radius:20px; background:#11161f; box-shadow: inset 0 0 0 1px #2b3442; position:relative; cursor:pointer;}
        .switch.on{ background:#0c2a20; box-shadow: inset 0 0 0 1px #2f5;}
        .switch .nub{ position:absolute; top:3px; left:4px; width:18px; height:18px; border-radius:50%; background:#2a3546; box-shadow: 0 1px 0 #0008, inset 0 0 0 1px #3b465a; transition:transform .15s ease;}
        .switch.on .nub{ transform: translateX(24px); background:#3ccfa7; box-shadow: inset 0 0 0 1px #58c8ad;}
        .toggle .label{ font-size:13px; opacity:.85;}

        .selector{ display:flex; flex-direction:column; gap:6px; }
        .selector-label{ font-size:12px; opacity:.75; letter-spacing:.08em; text-transform:uppercase; }
        .selector-row{ display:flex; gap:6px; flex-wrap:wrap; }
        .selector-btn{
          font-size:12px; padding:6px 10px; border-radius:6px; letter-spacing:.04em;
          background:#121823; border:1px solid #2b3442; color:#cfe4ff; opacity:.9;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        }
        .selector-btn.active{ background:#0d201b; border-color:#2f5; color:#eafff4; box-shadow: 0 0 0 1px #2f5 inset, 0 0 10px #2f5a; }

        .ledbar{ display:flex; flex-direction:column; gap:3px; width:14px; padding:2px; background:#0a0f15; border:1px solid #2b3442; border-radius:4px; box-shadow: inset 0 2px 8px #000a; }
        .led{ height:10px; border-radius:2px; background:#0f1a15; box-shadow: inset 0 0 0 1px #10221b; }
        .led.on{ background:linear-gradient(#4be0b5,#97ffe6); box-shadow: 0 0 6px #6ff0c9aa, inset 0 0 0 1px #2b7a66; }
        .led.hot.on{ background:linear-gradient(#ffa34a,#ffe38a); box-shadow: 0 0 7px #ffd56aaa, inset 0 0 0 1px #9a7a2a; }

        .rotary{ position:relative; width:calc(var(--knob-size) + 22px); display:flex; flex-direction:column; align-items:center; gap:6px; }
        .range-hidden{ position:absolute; inset:0; opacity:0; cursor:pointer; }

        .knob{
          width:var(--knob-size); height:var(--knob-size); border-radius:50%;
          position:relative; transform-origin:center 40px;
          background: radial-gradient(120% 120% at 30% 30%, #3a465a, #242c39 60%, #1a212b);
          border:1px solid #405065;
          box-shadow: inset 0 6px 12px rgba(0,0,0,.55), inset 0 -8px 14px rgba(0,0,0,.45), 0 4px 14px rgba(0,0,0,.45);
          transition: transform .06s ease;
        }
        .knob:hover{ transform: scale(1.02) translateZ(0); }
        .knob-rim{ position:absolute; inset:-10px; border-radius:50%; background: radial-gradient(circle at 30% 30%, #4e5c74, #253041 60%, #141a23 100%); box-shadow: inset 0 0 0 1px #2a3442, inset 0 12px 18px rgba(255,255,255,.05), inset 0 -8px 14px rgba(0,0,0,.55); z-index:-1; }
        .knob-ticks{ position:absolute; inset:-2px; border-radius:50%; background:
            radial-gradient(circle at 50% 50%, transparent 36%, #121923 37% 38%, transparent 39% 100%),
            repeating-conic-gradient(from -130deg, #5d6b82 0deg 2deg, transparent 2deg 12deg);
          filter: drop-shadow(0 1px 0 #000); }
        .knob::after{ content:""; position:absolute; left:8%; top:10%; width:60%; height:34%; border-radius:50%;
          background: radial-gradient(ellipse at 40% 40%, rgba(255,255,255,.35), rgba(255,255,255,0) 70%); transform: rotate(-20deg); mix-blend-mode:screen; opacity:.35; pointer-events:none; }
        .knob-cap{ position:absolute; left:50%; top:50%; width:28%; height:28%; transform:translate(-50%,-50%); border-radius:50%;
          background: radial-gradient(circle at 35% 35%, #6f7d91, #3c4658 60%, #232c39); box-shadow: inset 0 1px 1px #aab4c066, inset 0 -2px 6px #0008, 0 1px 0 #000a; border:1px solid #2a3646; }
        .pointer{ position:absolute; left:50%; top:8px; width:3px; height:16px; margin-left:-1.5px; background:linear-gradient(#caffdd,#7df5b2); border-radius:2px; box-shadow:0 0 10px rgba(158,255,169,.65); }
        .rotary-label{ text-align:center; }
        .rotary-label .name{ font-size:12px; opacity:.8; letter-spacing:.08em; text-transform:uppercase; text-shadow:0 1px 0 #000; }
        .rotary-label .val{ font-size:11px; opacity:.6; }

        @media (max-height: 720px) { .panel{ height:92vh; } .side{ overflow:auto; } }
      `}</style>

      <div className="panel">
        {/* LEFT: Display bay */}
        <div className="crt-wrap">
          <div className={`crt ${power ? "glow" : ""}`} ref={crtRef}>
            <canvas ref={canvasRef} />
          </div>
          <div className="brand">{mode === "eq" ? "graphic equalizer" : "vector scope display"}</div>
        </div>

        {/* RIGHT: controls */}
        <div className="side">
          <div className="logo">NEATS 0630KNM</div>

          <div className="group">
            <div className="group-title">Power</div>
            <div className="row">
              <div className="toggle">
                <div className={`switch ${power ? "on" : ""}`} onClick={() => setPower((p) => !p)}>
                  <div className="nub" />
                </div>
                <span className="label">{power ? "ON" : "OFF"}</span>
              </div>
              <button className="full-btn" onClick={toggleFullscreen}>
                {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              <div className="meters">
                <LedBar level={vuL} />
                <LedBar level={vuR} />
              </div>
            </div>
          </div>

          <div className="group">
            <div className="group-title">Mode / Grid</div>
            <div className="row">
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
              <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
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
                  onChange={(v) => (v === "on" ? setEqPeakHold(true) : setEqPeakHold(false))}
                  options={[
                    { value: "on", text: "Hold" },
                    { value: "off", text: "Off" },
                  ]}
                />
                <div className="toggle" style={{ gap: 8 }}>
                  <span className="label" style={{ marginRight: 4 }}>
                    Smoothing
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.95}
                    step={0.05}
                    value={eqSmoothing}
                    onChange={(e) => setEqSmoothing(+e.target.value)}
                    style={{ width: 160 }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="group">
            <div className="group-title">Geometry</div>
            <div className="knob-row" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              <Rotary label="Rotate" min={-180} max={180} step={1} value={rotation} onChange={setRotation} />
              <Rotary label="Aspect" min={0.4} max={2} step={0.01} value={aspect} onChange={setAspect} showValue />
              <Rotary label="Gain" min={0} max={2} step={0.01} value={gain} onChange={setGain} showValue />
            </div>
          </div>

          <div className="group">
            <div className="group-title">Filters</div>
            <div className="knob-row" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              <Rotary label="HPF Hz" min={5} max={200} step={1} value={hpf} onChange={setHpf} />
              <Rotary label="LPF Hz" min={200} max={20000} step={10} value={lpf} onChange={setLpf} />
              <Rotary
                label="Persist"
                min={0}
                max={0.98}
                step={0.01}
                value={persistence}
                onChange={setPersistence}
                showValue
              />
            </div>
          </div>

          <div className="group">
            <div className="group-title">Phosphor</div>
            <div className="knob-row" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              <Rotary label="Thickness" min={0.6} max={6} step={0.1} value={thickness} onChange={setThickness} />
              <Rotary label="Glow" min={0} max={16} step={1} value={glow} onChange={setGlow} />
              <Rotary label="Gamma" min={0.8} max={1.6} step={0.01} value={gamma} onChange={setGamma} />
            </div>
            <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
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
                <div className="row" style={{ gap: 8 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: "1px solid #2b3442",
                      boxShadow: "inset 0 0 0 1px #4e5a66",
                      background: monoColor,
                    }}
                  />
                  <input
                    type="color"
                    value={monoColor}
                    onChange={(e) => setMonoColor(e.target.value)}
                    style={{ background: "transparent", border: "none" }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
