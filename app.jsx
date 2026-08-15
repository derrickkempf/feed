import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/*
  DAYLOG v2 — visual diary · quiet storefront · portfolio pages.

  New in v2:
  · FREEFORM CANVAS (workof.club / self-healing.art): each day is an open
    composition. In owner mode, drag images and text notes anywhere — they
    snap to an invisible grid (2% steps). Cycle sizes with ⤢. Mobile and
    filtered views fall back to a clean stacked flow.
  · SPLIT-SCREEN DETAIL (batz.art): click any image → same-window split
    view. Image left, details right: date, caption, tags, product (buy),
    linked page. Owner edits the caption right there.
  · HOVER REVEAL (fieldnotesbrand.com): info + buttons surface on hover.
  · PROPER LOGIN MODAL instead of browser prompts (⌘/Ctrl+Shift+L, or tap
    the wordmark 5×).

  Storage (artifact): window.storage
    days-index  → [{ date, notes:[{id,text,fx,fy,fw}],
                     images:[{id,w,h,tags,cap?,product?,page?,fx?,fy?,fw?,demo?}] }]
    img:*, pages, pgimg:* as before.
  Layout units: fx/fy/fw are % of canvas width, so compositions scale.
*/

const INDEX_KEY = "days-index";
const PAGES_KEY = "pages";
const MAX_DIM = 1600;
const TARGET_BYTES = 1_800_000;
const SNAP = 2;               // invisible grid: 2% steps
const SIZES = [22, 32, 46, 64]; // ⤢ cycles these widths (%)
const SITE_NAME = "Derrick Kempf";
const SITE_TAGLINE = "Artist & Brand Identity Designer";
const SITE_HERO = ["A daily record of", "what I'm making"];
const SOCIALS = [
  { label: "X", url: "https://x.com/derrickkempf" },
  { label: "Instagram", url: "https://instagram.com/derrickkempf" },
  { label: "LinkedIn", url: "https://www.linkedin.com/in/derrickkempf" },
];

// ---------- date helpers ----------
const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => fmtDate(new Date());
const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtDate(d);
};
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const dayLabel = (dateStr) => {
  if (dateStr === todayStr()) return "Today";
  if (dateStr === daysAgoStr(1)) return "Yesterday";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const month = dt.toLocaleDateString("en-US", { month: "long" });
  if (y === new Date().getFullYear()) {
    const weekday = dt.toLocaleDateString("en-US", { weekday: "long" });
    return `${weekday}, ${month} ${ordinal(d)}`;
  }
  return `${month} ${ordinal(d)}, ${y}`;
};

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const normTag = (s) => s.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").slice(0, 24);
const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "page";
const snap = (v) => Math.round(v / SNAP) * SNAP;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- storage ----------
async function loadJSON(key, fallback) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}
const loadIndex = () => loadJSON(INDEX_KEY, []);
const loadPages = () => loadJSON(PAGES_KEY, []);
const saveIndex = (idx) => window.storage.set(INDEX_KEY, JSON.stringify(idx));
const savePages = (pgs) => window.storage.set(PAGES_KEY, JSON.stringify(pgs));

// ---------- routing ----------
const parseHash = () => {
  const h = window.location.hash;
  if (h === "#/work") return { kind: "work" };
  if (h === "#/about") return { kind: "about" };
  const m = h.match(/^#\/p\/(.+)$/);
  return m ? { kind: "page", slug: decodeURIComponent(m[1]) } : null;
};
const openPageHash = (slug) => (window.location.hash = `#/p/${encodeURIComponent(slug)}`);
const openWorkHash = () => (window.location.hash = "#/work");
const openAboutHash = () => (window.location.hash = "#/about");
const closePageHash = () => (window.location.hash = "");

// ---------- image compression ----------
function compressFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const scale = Math.min(1, MAX_DIM / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let q = 0.82;
      let data = canvas.toDataURL("image/jpeg", q);
      while (data.length > TARGET_BYTES && q > 0.4) {
        q -= 0.12;
        data = canvas.toDataURL("image/jpeg", q);
      }
      resolve({ data, w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("read failed"));
    };
    img.src = url;
  });
}

// ---------- demo placeholders ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function demoDataURL(seed, w, h) {
  const H = hashStr(seed);
  const rand = (() => {
    let s = H || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  })();
  const scale = Math.min(1, 900 / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d");
  const g = (v) => `rgb(${v},${v},${v})`;
  const variant = H % 6;
  ctx.fillStyle = g(235 - Math.floor(rand() * 30));
  ctx.fillRect(0, 0, cw, ch);
  if (variant === 0) {
    const gr = ctx.createLinearGradient(0, 0, 0, ch);
    gr.addColorStop(0, g(40 + rand() * 40));
    gr.addColorStop(1, g(215 + rand() * 30));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, cw, ch);
  } else if (variant === 1) {
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rand() * 60 - 30) * (Math.PI / 180));
    const sw = 14 + rand() * 30;
    ctx.fillStyle = g(30 + rand() * 40);
    for (let x = -cw; x < cw; x += sw * 2) ctx.fillRect(x, -ch, sw, ch * 2);
    ctx.restore();
  } else if (variant === 2) {
    const cx = cw * (0.3 + rand() * 0.4);
    const cy = ch * (0.3 + rand() * 0.4);
    const rings = 6 + Math.floor(rand() * 6);
    const maxR = Math.max(cw, ch) * 0.75;
    for (let i = rings; i > 0; i--) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxR / rings) * i, 0, Math.PI * 2);
      ctx.fillStyle = g(i % 2 === 0 ? 235 - i * 6 : 45 + i * 10);
      ctx.fill();
    }
  } else if (variant === 3) {
    ctx.fillStyle = g(245);
    ctx.fillRect(0, 0, cw, ch);
    const step = 22 + rand() * 14;
    ctx.fillStyle = g(25);
    for (let y = step / 2; y < ch; y += step)
      for (let x = step / 2; x < cw; x += step) {
        const r = ((x / cw + y / ch) / 2) * (step * 0.42) + 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
  } else if (variant === 4) {
    ctx.fillStyle = g(rand() > 0.5 ? 240 : 210);
    ctx.fillRect(0, 0, cw, ch);
    ctx.beginPath();
    ctx.arc(cw * (0.35 + rand() * 0.3), ch * (0.35 + rand() * 0.3), Math.min(cw, ch) * (0.22 + rand() * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = g(20 + rand() * 30);
    ctx.fill();
  } else {
    const gr = ctx.createLinearGradient(0, 0, cw, ch);
    gr.addColorStop(0, g(70 + rand() * 40));
    gr.addColorStop(1, g(200 + rand() * 40));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, cw, ch);
    const img = ctx.getImageData(0, 0, cw, ch);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const n = (rand() - 0.5) * 46;
      px[i] += n; px[i + 1] += n; px[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  return c.toDataURL("image/jpeg", 0.8);
}

function buildDemoIndex() {
  const spec = [
    { ago: 1, shapes: [[1200, 800, ["studio", "print"]], [800, 1100, ["sketch"]], [1000, 1000, ["texture"]]] },
    { ago: 2, shapes: [[900, 1200, ["sketch", "type"]], [1200, 750, ["studio"]]] },
    { ago: 4, shapes: [[1000, 1250, ["print"]], [1200, 800, ["texture", "studio"]], [800, 800, ["type"]], [1100, 700, []]] },
    { ago: 7, shapes: [[1200, 900, ["texture"]]] },
    { ago: 9, shapes: [[800, 1200, ["sketch"]], [1200, 800, ["print", "type"]], [1000, 900, ["studio"]]] },
  ];
  const idx = spec.map(({ ago, shapes }) => ({
    date: daysAgoStr(ago),
    notes: [],
    images: shapes.map(([w, h, tags]) => ({ id: uid(), w, h, tags, demo: true })),
  }));
  idx[0].images[0].product = {
    name: "Halftone No. 3 — Print",
    price: "$40",
    url: "https://your-shop.fourthwall.com/products/halftone-no-3",
  };
  idx[0].images[0].cap = "Proof pull, coarse screen.";
  idx[2].images[0].page = "halftone-studies";
  // a freeform composition + a floating note on yesterday's canvas
  idx[0].images[0].fx = 4;  idx[0].images[0].fy = 0;  idx[0].images[0].fw = 42;
  idx[0].images[1].fx = 62; idx[0].images[1].fy = 8;  idx[0].images[1].fw = 26;
  idx[0].images[2].fx = 30; idx[0].images[2].fy = 34; idx[0].images[2].fw = 30;
  idx[0].notes.push({
    id: uid(),
    text: "Studio week — proofing the halftone series before the edition goes to press.",
    fx: 66, fy: 44, fw: 26,
  });
  return idx;
}

function buildDemoPages() {
  return [
    {
      slug: "halftone-studies",
      title: "Halftone Studies",
      subtitle: "2026 — Screen prints, edition of 20",
      body:
        "A month of reducing photographs to pure dot frequency. Each study takes one image from the daily scroll and pushes it through coarser and coarser screens until the picture almost disappears — the last print in the series is one dot.\n\nThe full edition was printed by hand on 300gsm cotton rag.",
      images: [
        { id: "pgd1", w: 1400, h: 950, demo: true },
        { id: "pgd2", w: 1100, h: 1400, demo: true },
        { id: "pgd3", w: 1400, h: 1000, demo: true },
      ],
    },
  ];
}

// ---------- backup ----------
async function buildBackup(index, pages) {
  const days = [];
  for (const d of index) {
    const images = [];
    for (const m of d.images) {
      if (m.demo) continue;
      let data = null;
      try {
        const r = await window.storage.get(`img:${d.date}:${m.id}`);
        data = r ? r.value : null;
      } catch {}
      if (data) images.push({ ...m, data });
    }
    if (images.length || (d.notes || []).length) days.push({ date: d.date, notes: d.notes || [], images });
  }
  const outPages = [];
  for (const p of pages) {
    const imgs = [];
    for (const m of p.images) {
      if (m.demo) continue;
      let data = null;
      try {
        const r = await window.storage.get(`pgimg:${p.slug}:${m.id}`);
        data = r ? r.value : null;
      } catch {}
      if (data) imgs.push({ id: m.id, w: m.w, h: m.h, data });
    }
    outPages.push({ slug: p.slug, title: p.title, subtitle: p.subtitle, body: p.body, images: imgs });
  }
  return { app: "daylog", version: 4, exported: new Date().toISOString(), days, pages: outPages };
}
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- hooks ----------
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const fn = (e) => setM(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return m;
}

// lazy dataURL loader (storage or demo)
function useLazySrc(elRef, meta, storageKey, demoSeed) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          if (meta.demo) {
            const d = demoDataURL(demoSeed, meta.w, meta.h);
            if (!cancelled) setSrc(d);
            return;
          }
          try {
            const r = await window.storage.get(storageKey);
            if (!cancelled) setSrc(r ? r.value : "x");
          } catch {
            if (!cancelled) setSrc("x");
          }
        }
      },
      { rootMargin: "900px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [storageKey, demoSeed, meta.demo, meta.w, meta.h, elRef]);
  return src;
}

// ---------- freeform layout ----------
// returns concrete {fx,fy,fw} for every item; auto-flows any without positions
function resolveLayout(day, cols) {
  const gap = 3;
  const colW = (100 - gap * (cols + 1)) / cols;
  const colY = new Array(cols).fill(0);
  const out = new Map();
  // seed column heights with explicitly placed items so auto items avoid them less naively
  const placed = [];
  for (const m of day.images) {
    if (m.fx != null) placed.push(m);
  }
  for (const m of day.images) {
    if (m.fx != null) {
      out.set(m.id, { fx: m.fx, fy: m.fy, fw: m.fw ?? 30 });
    } else {
      const c = colY.indexOf(Math.min(...colY));
      const fw = colW;
      const fx = gap + c * (colW + gap);
      const fy = colY[c];
      const fh = fw / (m.w / m.h);
      colY[c] = fy + fh + gap;
      out.set(m.id, { fx, fy, fw });
    }
  }
  for (const n of day.notes || []) {
    out.set(n.id, { fx: n.fx ?? 4, fy: n.fy ?? 2, fw: n.fw ?? 28 });
  }
  return out;
}

// ---------- login modal ----------
function LoginModal({ onClose, onSubmit }) {
  const [pass, setPass] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="dl-modal-veil" onClick={onClose}>
      <div className="dl-modal dl-login" role="dialog" aria-modal="true" aria-label="Log in" onClick={(e) => e.stopPropagation()}>
        <button className="dl-modal-x" aria-label="Close" onClick={onClose}>×</button>
        <h2>Log in</h2>
        <p className="dl-shopnote">Owner access — add, arrange, tag, link, and sell.</p>
        <input
          ref={ref}
          className="dl-login-input"
          type="password"
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(pass)}
        />
        <button className="dl-buy dl-login-btn" onClick={() => onSubmit(pass)}>Log in</button>
        <p className="dl-hint">In this preview any passphrase works. The live site checks real credentials.</p>
      </div>
    </div>
  );
}

// ---------- split-screen detail ----------
function DetailSplit({ date, meta, pages, canEdit, onClose, onSaveCaption, onShopBuy, onOpenPage, onTagClick }) {
  const holderRef = useRef(null);
  const src = useLazySrc(holderRef, meta, `img:${date}:${meta.id}`, `${date}-${meta.id}`);
  const linkedPage = meta.page && pages.find((p) => p.slug === meta.page);
  const [cap, setCap] = useState(meta.cap || "");
  useEffect(() => setCap(meta.cap || ""), [meta.id, meta.cap]);

  return (
    <div className="dl-split" role="dialog" aria-modal="true" aria-label="Image detail">
      <button className="dl-modal-x dl-split-x" aria-label="Close" onClick={onClose}>×</button>
      <div className="dl-split-img" ref={holderRef}>
        {src && src !== "x" ? <img src={src} alt={cap || ""} /> : <div className="dl-ph" style={{ position: "absolute", inset: 24 }} />}
      </div>
      <aside className="dl-split-info">
        <p className="dl-split-date">{dayLabel(date)}</p>

        {canEdit ? (
          <textarea
            className="dl-split-capedit"
            value={cap}
            rows={3}
            placeholder="Caption…"
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => onSaveCaption(date, meta.id, cap.trim())}
          />
        ) : (
          meta.cap && <p className="dl-split-cap">{meta.cap}</p>
        )}

        {(meta.tags || []).length > 0 && (
          <div className="dl-split-tags">
            {meta.tags.map((t) => (
              <button key={t} className="dl-minitag" onClick={() => { onClose(); onTagClick(t); }}>{t}</button>
            ))}
          </div>
        )}

        {linkedPage && (
          <div className="dl-split-block">
            <p className="dl-split-label">Project</p>
            <button className="dl-split-pagelink" onClick={() => { onClose(); onOpenPage(linkedPage.slug); }}>
              {linkedPage.title} ↗
            </button>
          </div>
        )}

        {meta.product && (
          <div className="dl-split-block">
            <p className="dl-split-label">Available</p>
            <p className="dl-split-prodname">{meta.product.name}</p>
            {meta.product.price && <p className="dl-shopprice">{meta.product.price}</p>}
            <button className="dl-buy" onClick={() => onShopBuy(meta)}>Buy on Fourthwall ↗</button>
            <p className="dl-shopnote">Checkout, payment, and shipping handled by Fourthwall.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------- canvas items ----------
function CanvasImg({ date, meta, pos, canEdit, drag, onDragStart, onOpen, onCycleSize, onEdit, onDelete, editing, editors }) {
  const ref = useRef(null);
  const src = useLazySrc(ref, meta, `img:${date}:${meta.id}`, `${date}-${meta.id}`);
  const isDragging = drag && drag.id === meta.id;
  const style = {
    left: `${pos.fx}%`,
    top: `${pos.top}px`,
    width: `${pos.fw}%`,
    transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
    zIndex: isDragging ? 5 : undefined,
  };
  const kindOpen = (k) => editing && editing.kind === k && editing.id === meta.id;
  const editorOpen = kindOpen("tags") || kindOpen("product") || kindOpen("page");

  return (
    <figure
      ref={ref}
      className={`dl-item dl-item-img ${isDragging ? "dl-item-drag" : ""} ${editorOpen ? "dl-fig-editing" : ""}`}
      style={style}
      onPointerDown={(e) => canEdit && !editorOpen && onDragStart(e, meta.id, "img")}
      onClick={() => !editorOpen && onOpen(meta)}
    >
      <span className="dl-imgbox" style={{ aspectRatio: `${meta.w} / ${meta.h}` }}>
      {src && src !== "x" ? (
        <img src={src} alt={meta.cap || ""} draggable={false} />
      ) : (
        <div className={`dl-ph ${src === "x" ? "dl-ph-x" : ""}`}>{src === "x" ? "missing" : ""}</div>
      )}

      {/* fieldnotes-style hover reveal */}
      {!editorOpen && (meta.product || meta.page) && (
        <div className="dl-hoverbar">
          <span className="dl-hoverbar-text">
            {meta.product ? meta.product.name : "Project"}
            {meta.product?.price ? <em> {meta.product.price}</em> : null}
          </span>
          <span className="dl-hoverbar-btn">{meta.product ? "Shop" : "View"}</span>
        </div>
      )}
      </span>
      {meta.cap && <figcaption className="dl-itemcap">{meta.cap}</figcaption>}

      {canEdit && !editorOpen && (
        <div className="dl-fig-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button className="dl-act" title="Cycle size" aria-label="Cycle size" onClick={() => onCycleSize(meta.id)}>⤢</button>
          <button className={`dl-act ${meta.page ? "dl-act-on" : ""}`} title="Link a page" aria-label="Link a page" onClick={() => onEdit({ id: meta.id, kind: "page" })}>↗</button>
          <button className={`dl-act ${meta.product ? "dl-act-on" : ""}`} title="Link product" aria-label="Link product" onClick={() => onEdit({ id: meta.id, kind: "product" })}>$</button>
          <button className="dl-act" title="Edit tags" aria-label="Edit tags" onClick={() => onEdit({ id: meta.id, kind: "tags" })}>#</button>
          <button className="dl-act" title="Remove" aria-label="Remove image" onClick={() => onDelete(meta.id)}>×</button>
        </div>
      )}

      {editorOpen && <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>{editors}</div>}
    </figure>
  );
}

function CanvasNote({ note, pos, canEdit, drag, onDragStart, onEditText, onDelete }) {
  const [editingText, setEditingText] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const isDragging = drag && drag.id === note.id;
  const style = {
    left: `${pos.fx}%`,
    top: `${pos.top}px`,
    width: `${pos.fw}%`,
    transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
    zIndex: isDragging ? 5 : 2,
  };
  return (
    <div
      className={`dl-item dl-item-note ${isDragging ? "dl-item-drag" : ""}`}
      style={style}
      onPointerDown={(e) => canEdit && !editingText && onDragStart(e, note.id, "note")}
    >
      {editingText ? (
        <textarea
          className="dl-note-edit"
          value={draft}
          rows={3}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditingText(false);
            onEditText(note.id, draft.trim());
          }}
          onKeyDown={(e) => e.key === "Escape" && setEditingText(false)}
        />
      ) : (
        <p className="dl-note-text">{note.text}</p>
      )}
      {canEdit && !editingText && (
        <div className="dl-fig-actions dl-note-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button className="dl-act" title="Edit text" aria-label="Edit text" onClick={() => { setDraft(note.text); setEditingText(true); }}>✎</button>
          <button className="dl-act" title="Remove" aria-label="Remove note" onClick={() => onDelete(note.id)}>×</button>
        </div>
      )}
    </div>
  );
}

// ---------- editors (tags / product / page-link) ----------
function TagEditor({ meta, onSave, onClose }) {
  const [tags, setTags] = useState(meta.tags || []);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const commit = (list) => {
    setTags(list);
    onSave(meta.id, list);
  };
  const addDraft = () => {
    const t = normTag(draft);
    if (t && !tags.includes(t)) commit([...tags, t]);
    setDraft("");
  };
  return (
    <div className="dl-tagedit">
      <div className="dl-tagedit-chips">
        {tags.map((t) => (
          <span key={t} className="dl-chip dl-chip-on">
            {t}
            <button aria-label={`Remove tag ${t}`} onClick={() => commit(tags.filter((x) => x !== t))}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          placeholder={tags.length ? "add tag" : "add a tag…"}
          onChange={(e) => {
            if (e.target.value.endsWith(",")) {
              setDraft(e.target.value.slice(0, -1));
              addDraft();
            } else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) addDraft();
              else onClose();
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <button className="dl-tagedit-done" onClick={() => { if (draft.trim()) addDraft(); onClose(); }}>Done</button>
    </div>
  );
}

function ProductEditor({ meta, onSave, onClose }) {
  const p = meta.product || {};
  const [name, setName] = useState(p.name || "");
  const [price, setPrice] = useState(p.price || "");
  const [url, setUrl] = useState(p.url || "");
  const nameRef = useRef(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const save = () => {
    const clean = { name: name.trim(), price: price.trim(), url: url.trim() };
    onSave(meta.id, clean.name || clean.url ? clean : null);
    onClose();
  };
  return (
    <div className="dl-prodedit">
      <input ref={nameRef} value={name} placeholder="Product name" onChange={(e) => setName(e.target.value)} />
      <input value={price} placeholder="Price (e.g. $40)" onChange={(e) => setPrice(e.target.value)} />
      <input
        value={url}
        placeholder="Fourthwall product URL"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="dl-prodedit-row">
        {meta.product && <button className="dl-prodedit-remove" onClick={() => { onSave(meta.id, null); onClose(); }}>Unlink</button>}
        <button className="dl-prodedit-save" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function PageLinkEditor({ meta, pages, onLink, onCreateAndLink, onClose }) {
  const [title, setTitle] = useState("");
  return (
    <div className="dl-prodedit">
      {pages.length > 0 && (
        <select
          className="dl-pagepick"
          defaultValue={meta.page || ""}
          onChange={(e) => {
            if (e.target.value) {
              onLink(meta.id, e.target.value);
              onClose();
            }
          }}
        >
          <option value="" disabled>Link to an existing page…</option>
          {pages.map((p) => (
            <option key={p.slug} value={p.slug}>{p.title}</option>
          ))}
        </select>
      )}
      <input
        value={title}
        placeholder="…or new page title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            onCreateAndLink(meta.id, title.trim());
            onClose();
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="dl-prodedit-row">
        {meta.page && <button className="dl-prodedit-remove" onClick={() => { onLink(meta.id, null); onClose(); }}>Unlink</button>}
        <button
          className="dl-prodedit-save"
          onClick={() => {
            if (title.trim()) onCreateAndLink(meta.id, title.trim());
            onClose();
          }}
        >
          {title.trim() ? "Create + link" : "Done"}
        </button>
      </div>
    </div>
  );
}

// ---------- one day: freeform canvas (desktop) / stacked flow (mobile & filter) ----------
function DayCanvas({ day, isToday, canEdit, filterOn, isMobile, pages, onPick, onAddNote, onLayout, onOpenDetail, onCycleSize, onDeleteImage, onEditNoteText, onDeleteNote, editing, setEditing, onSaveTags, onSaveProduct, onLinkPage, onCreatePage }) {
  const [wrapRef, width] = useWidth();
  const [drag, setDrag] = useState(null); // {id, kind, startX, startY, dx, dy, moved}
  const dragRef = useRef(null);
  dragRef.current = drag;

  const flat = !filterOn && !isMobile ? false : true; // stacked flow when filtering or on mobile
  const layout = useMemo(() => {
    const base = resolveLayout(day, width < 860 ? 2 : 3);
    const out = new Map();
    for (const [id, p] of base) out.set(id, { ...p, top: (p.fy / 100) * (width || 1) });
    return out;
  }, [day, width]);

  // canvas height in width-% units
  const heightPct = useMemo(() => {
    let max = 0;
    for (const m of day.images) {
      const p = layout.get(m.id);
      if (!p) continue;
      max = Math.max(max, p.fy + p.fw / (m.w / m.h) + (m.cap ? 4 : 0));
    }
    for (const n of day.notes || []) {
      const p = layout.get(n.id);
      if (!p) continue;
      const est = ((n.text.length / (p.fw * 0.5)) + 2) * 3; // rough text height estimate
      max = Math.max(max, p.fy + est);
    }
    return max + 2;
  }, [day, layout]);

  // ---- drag machinery (pointer events; 6px threshold separates click from drag) ----
  const onDragStart = (e, id, kind) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, kind, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      setDrag((d) => {
        if (!d) return d;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        const moved = d.moved || Math.hypot(dx, dy) > 6;
        return { ...d, dx, dy, moved };
      });
    };
    const up = () => {
      const d = dragRef.current;
      if (d && d.moved && width > 0) {
        const p = layout.get(d.id);
        if (p) {
          const fx = clamp(snap(p.fx + (d.dx / width) * 100), 0, 100 - p.fw);
          const fy = Math.max(0, snap(p.fy + (d.dy / width) * 100));
          onLayout(day.date, d.id, d.kind, { fx, fy, fw: p.fw }, layout);
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag ? drag.id : null, width, layout, day.date, onLayout]);

  const empty = day.images.length === 0 && (day.notes || []).length === 0;

  const editorsFor = (m) => {
    if (!editing || editing.date !== day.date || editing.id !== m.id) return null;
    if (editing.kind === "tags") return <TagEditor meta={m} onSave={(id, tags) => onSaveTags(day.date, id, tags)} onClose={() => setEditing(null)} />;
    if (editing.kind === "product") return <ProductEditor meta={m} onSave={(id, product) => onSaveProduct(day.date, id, product)} onClose={() => setEditing(null)} />;
    if (editing.kind === "page") return <PageLinkEditor meta={m} pages={pages} onLink={(id, slug) => onLinkPage(day.date, id, slug)} onCreateAndLink={(id, title) => onCreatePage(day.date, id, title)} onClose={() => setEditing(null)} />;
    return null;
  };

  return (
    <section className="dl-day">
      <header className="dl-dayhead">
        <span className="dl-daylabel">{dayLabel(day.date)}</span>
        {canEdit && !filterOn && (
          <button className="dl-addnote" onClick={() => onAddNote(day.date)}>+ note</button>
        )}
      </header>

      {empty && isToday && canEdit && !filterOn ? (
        <button className="dl-stage" onClick={onPick}>
          <span className="dl-stage-title">Today</span>
          <span>Drag images anywhere on this page</span>
          <span className="dl-stage-sub">or tap here to choose files</span>
        </button>
      ) : flat ? (
        <div className="dl-grid">
          {day.images.map((m) => (
            <figure key={m.id} className="dl-fig" onClick={() => onOpenDetail(day.date, m)}>
              <span className="dl-imgbox" style={{ aspectRatio: `${m.w} / ${m.h}` }}>
                <FlatImg date={day.date} meta={m} />
                {(m.product || m.page) && (
                  <div className="dl-hoverbar">
                    <span className="dl-hoverbar-text">
                      {m.product ? m.product.name : "Project"}
                      {m.product?.price ? <em> {m.product.price}</em> : null}
                    </span>
                    <span className="dl-hoverbar-btn">{m.product ? "Shop" : "View"}</span>
                  </div>
                )}
              </span>
              {m.cap && <figcaption className="dl-itemcap">{m.cap}</figcaption>}
            </figure>
          ))}
          {(day.notes || []).map((n) => (
            <div key={n.id} className="dl-note-flat"><p className="dl-note-text">{n.text}</p></div>
          ))}
        </div>
      ) : (
        <div
          ref={wrapRef}
          className={`dl-canvas ${canEdit ? "dl-canvas-edit" : ""}`}
          style={{ height: `${(heightPct / 100) * (width || 1)}px` }}
        >
          {day.images.map((m) => (
            <CanvasImg
              key={m.id}
              date={day.date}
              meta={m}
              pos={layout.get(m.id) || { fx: 4, fy: 2, fw: 30, top: 0 }}
              canEdit={canEdit}
              drag={drag && drag.moved ? drag : null}
              onDragStart={onDragStart}
              onOpen={(meta) => {
                if (dragRef.current?.moved) return;
                onOpenDetail(day.date, meta);
              }}
              onCycleSize={(id) => onCycleSize(day.date, id, layout)}
              onEdit={(ed) => setEditing({ ...ed, date: day.date })}
              onDelete={(id) => onDeleteImage(day.date, id)}
              editing={editing && editing.date === day.date ? editing : null}
              editors={editorsFor(m)}
            />
          ))}
          {(day.notes || []).map((n) => (
            <CanvasNote
              key={n.id}
              note={n}
              pos={layout.get(n.id) || { fx: 4, fy: 2, fw: 28, top: 0 }}
              canEdit={canEdit}
              drag={drag && drag.moved ? drag : null}
              onDragStart={onDragStart}
              onEditText={(id, text) => onEditNoteText(day.date, id, text)}
              onDelete={(id) => onDeleteNote(day.date, id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FlatImg({ date, meta }) {
  const ref = useRef(null);
  const src = useLazySrc(ref, meta, `img:${date}:${meta.id}`, `${date}-${meta.id}`);
  return (
    <span ref={ref} style={{ position: "absolute", inset: 0 }}>
      {src && src !== "x" ? <img src={src} alt={meta.cap || ""} draggable={false} /> : <div className={`dl-ph ${src === "x" ? "dl-ph-x" : ""}`} />}
    </span>
  );
}

// ---------- breadcrumb / work index / page view ----------
function Crumbs({ trail }) {
  return (
    <nav className="dl-crumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <span key={i} className="dl-crumb-wrap">
          {i > 0 && <span className="dl-crumb-sep">/</span>}
          {c.onGo ? <button className="dl-crumb" onClick={c.onGo}>{c.label}</button> : <span className="dl-crumb dl-crumb-here">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

function WorkCover({ page }) {
  const ref = useRef(null);
  const m = page.images[0];
  const src = useLazySrc(ref, m || { demo: false, w: 4, h: 3 }, m ? `pgimg:${page.slug}:${m.id}` : "none", m ? `pg-${page.slug}-${m.id}` : "none");
  return (
    <span ref={ref} className="dl-work-cover" style={{ aspectRatio: m ? `${m.w} / ${m.h}` : "4 / 3" }}>
      {m && src && src !== "x" ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="dl-work-cover-ph" />}
    </span>
  );
}

function WorkIndex({ pages, onOpen }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const snippet = (body) => {
    const first = (body || "").split(/\n\s*\n/)[0] || "";
    return first.length > 150 ? first.slice(0, 147).trimEnd() + "…" : first;
  };
  return (
    <div className="dl-page">
      <div className="dl-page-top">
        <Crumbs trail={[{ label: "Feed", onGo: closePageHash }, { label: "Works" }]} />
      </div>
      <div className="dl-work">
        <h1 className="dl-work-title">Works</h1>
        {pages.length === 0 ? (
          <p className="dl-loading">No project pages yet.</p>
        ) : (
          <div className="dl-work-grid">
            {pages.map((p) => (
              <button key={p.slug} className="dl-work-card" onClick={() => onOpen(p.slug)}>
                <WorkCover page={p} />
                <span className="dl-work-card-title">{p.title}</span>
                {p.body && <span className="dl-work-card-snip">{snippet(p.body)}</span>}
                <span className="dl-work-card-more">Read more</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}

function PageImg({ slug, meta, children }) {
  const ref = useRef(null);
  const src = useLazySrc(ref, meta, `pgimg:${slug}:${meta.id}`, `pg-${slug}-${meta.id}`);
  return (
    <figure ref={ref} className="dl-fig dl-page-fig" style={{ aspectRatio: `${meta.w} / ${meta.h}` }}>
      {src && src !== "x" ? <img src={src} alt="" loading="lazy" draggable={false} /> : <div className={`dl-ph ${src === "x" ? "dl-ph-x" : ""}`} />}
      {children}
    </figure>
  );
}

function PageView({ slug, pages, canEdit, onBack, onPatch, onAddImages, onRemoveImage, onDeletePage }) {
  const page = pages.find((p) => p.slug === slug);
  const [edit, setEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const addRef = useRef(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    setEdit(false);
    setConfirmDel(false);
  }, [slug]);

  if (!page) {
    return (
      <div className="dl-page">
        <div className="dl-page-top">
          <Crumbs trail={[{ label: "Feed", onGo: onBack }, { label: "Work", onGo: openWorkHash }, { label: "?" }]} />
        </div>
        <p className="dl-loading">That page doesn't exist (anymore).</p>
      </div>
    );
  }

  return (
    <div className="dl-page">
      <div className="dl-page-top">
        <Crumbs trail={[{ label: "Feed", onGo: onBack }, { label: "Work", onGo: openWorkHash }, { label: page.title }]} />
        {canEdit && (
          <div className="dl-page-tools">
            <button className="dl-back" onClick={() => setEdit((e) => !e)}>{edit ? "Done editing" : "Edit page"}</button>
            {edit && (
              <button
                className={`dl-back ${confirmDel ? "dl-del-confirm" : ""}`}
                onClick={() => {
                  if (!confirmDel) setConfirmDel(true);
                  else onDeletePage(slug);
                }}
              >
                {confirmDel ? "Confirm delete" : "Delete page"}
              </button>
            )}
          </div>
        )}
      </div>

      <article className="dl-page-body">
        {edit ? (
          <>
            <input className="dl-page-title-input" value={page.title} placeholder="Page title" onChange={(e) => onPatch(slug, { title: e.target.value })} />
            <input className="dl-page-sub-input" value={page.subtitle || ""} placeholder="Year — medium, edition… (subtitle)" onChange={(e) => onPatch(slug, { subtitle: e.target.value })} />
            <textarea className="dl-page-text-input" value={page.body || ""} placeholder="The deeper dive. Blank line = new paragraph." rows={7} onChange={(e) => onPatch(slug, { body: e.target.value })} />
          </>
        ) : (
          <>
            <h1 className="dl-page-title">{page.title}</h1>
            {page.subtitle && <p className="dl-page-sub">{page.subtitle}</p>}
            {(page.body || "").split(/\n\s*\n/).filter(Boolean).map((para, i) => (
              <p className="dl-page-text" key={i}>{para}</p>
            ))}
          </>
        )}

        <div className="dl-page-imgs">
          {page.images.map((m) => (
            <PageImg key={m.id} slug={slug} meta={m}>
              {edit && (
                <div className="dl-fig-actions" style={{ opacity: 1 }}>
                  <button className="dl-act" aria-label="Remove image" onClick={() => onRemoveImage(slug, m.id)}>×</button>
                </div>
              )}
            </PageImg>
          ))}
        </div>

        {edit && (
          <>
            <input
              ref={addRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) onAddImages(slug, e.target.files);
                e.target.value = "";
              }}
            />
            <button className="dl-stage dl-page-add" onClick={() => addRef.current?.click()}>+ Add images to this page</button>
          </>
        )}
      </article>
      <Footer />
    </div>
  );
}


// ---------- footer ----------
function Footer() {
  return (
    <footer className="dl-footer">
      <span className="dl-footer-c">© {new Date().getFullYear()}</span>
      <span className="dl-footer-links">
        {SOCIALS.map((so) => (
          <a key={so.label} href={so.url} target="_blank" rel="noopener noreferrer">{so.label}</a>
        ))}
      </span>
    </footer>
  );
}

// ---------- about page ----------
function AboutPage({ canEdit, pages, onOpenPage, onExport, onImport }) {
  const importRef = useRef(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="dl-page">
      <div className="dl-page-top">
        <Crumbs trail={[{ label: "Feed", onGo: closePageHash }, { label: "About" }]} />
      </div>
      <div className="dl-about">
        <h1 className="dl-work-title dl-about-title">About</h1>
        <div className="dl-about-cols">
          <div className="dl-about-img" aria-hidden="true" />
          <div className="dl-about-text">
            <p className="dl-about-hello">Hello!</p>
            <p>
              I'm Derrick Kempf, an artist and brand identity designer with over
              two decades of experience shaping brands and translating vision
              into meaningful design. I bring a balance of discipline and
              creative freedom to both brand consulting and personal art, and I
              am dedicated to helping fellow artists find simplicity and joy in
              the creative process. I love drawing and the subjects I illustrate
              typically consist of weird, balding men, or Dewds, as I call them.
              See more of them out at dewd.cool.
            </p>
            <p>Let's make something cool together.</p>
            <p>
              <a className="dl-about-mail" href="mailto:hello@derrickkempf.com">Email me</a> or connect with me on socials.
            </p>

            {canEdit && (
              <div className="dl-about-owner">
                <p className="dl-split-label">Pages</p>
                {pages.length ? (
                  <p className="dl-pagelist">
                    {pages.map((p, i) => (
                      <span key={p.slug}>
                        {i > 0 && " · "}
                        <a href={`#/p/${p.slug}`} onClick={(e) => { e.preventDefault(); onOpenPage(p.slug); }}>{p.title}</a>
                      </span>
                    ))}
                  </p>
                ) : (
                  <p>No pages yet — hover an image in the feed and hit ↗.</p>
                )}
                <p className="dl-split-label">Backup</p>
                <div className="dl-backup-row">
                  <button className="dl-backup-btn" onClick={onExport}>Export backup</button>
                  <button className="dl-backup-btn" onClick={() => importRef.current?.click()}>Import backup</button>
                  <input
                    ref={importRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.[0]) onImport(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
                <p className="dl-hint">Log in/out: ⌘/Ctrl+Shift+L · tap the wordmark 5× · or visit #login</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

// ---------- app ----------
export default function Daylog() {
  const [days, setDays] = useState(null);
  const [pages, setPages] = useState([]);
  const [route, setRoute] = useState(() => parseHash());
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [detail, setDetail] = useState(null); // {date, id}
  const [filter, setFilter] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [mode, setMode] = useState("owner");
  const canEdit = mode === "owner";
  const [editing, setEditing] = useState(null); // {date,id,kind}
  const dragDepth = useRef(0);
  const fileRef = useRef(null);
  const toastTimer = useRef(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const isMobile = useIsMobile();

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // boot
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@700;800&display=swap";
    document.head.appendChild(l);
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    (async () => {
      try {
        const s = await window.storage.get("session");
        if (s && (s.value === "owner" || s.value === "visitor")) setMode(s.value);
      } catch {}
      let idx = await loadIndex();
      let pgs = await loadPages();
      const demoOnly =
        idx.length > 0 &&
        idx.every((d) => d.images.every((m) => m.demo)) &&
        idx.every((d) => d.images.every((m) => !m.product && !m.page));
      if (idx.length === 0 || demoOnly) {
        idx = buildDemoIndex();
        if (pgs.length === 0) pgs = buildDemoPages();
        try {
          await saveIndex(idx);
          await savePages(pgs);
        } catch {}
      }
      idx.forEach((d) => {
        if (!d.notes) d.notes = [];
      });
      setDays(idx);
      setPages(pgs);
    })();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const applyMode = useCallback(
    async (next) => {
      setMode(next);
      setEditing(null);
      try {
        await window.storage.set("session", next);
      } catch {}
      say(next === "visitor" ? "Logged out — this is what visitors see." : "Logged in — drag to arrange, tap ⤢ to resize.");
    },
    [say]
  );

  const requestLoginToggle = useCallback(() => {
    if (canEdit) applyMode("visitor");
    else setLoginOpen(true);
  }, [canEdit, applyMode]);

  const today = todayStr();
  const baseDays = (() => {
    if (!days) return null;
    if (!canEdit) return days.filter((d) => d.images.length > 0 || (d.notes || []).length > 0);
    if (days.length && days[0].date === today) return days;
    return [{ date: today, images: [], notes: [] }, ...days.filter((d) => d.date !== today)];
  })();

  const allTags = useMemo(() => {
    const map = new Map();
    (days || []).forEach((d) => d.images.forEach((m) => (m.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1))));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [days]);

  useEffect(() => {
    if (!filter.length) return;
    const live = new Set(allTags.map(([t]) => t));
    const kept = filter.filter((t) => live.has(t));
    if (kept.length !== filter.length) setFilter(kept);
  }, [allTags, filter]);

  const filterOn = filter.length > 0;

  const viewDays = (() => {
    if (!baseDays) return null;
    if (!filterOn) return baseDays;
    return baseDays
      .map((d) => ({
        ...d,
        notes: [],
        images: d.images.filter((m) => (m.tags || []).some((t) => filter.includes(t))),
      }))
      .filter((d) => d.images.length > 0);
  })();

  const matchCount = filterOn && viewDays ? viewDays.reduce((n, d) => n + d.images.length, 0) : 0;
  const toggleTag = (t) => setFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));

  // ---------- index mutations ----------
  const mutateIndex = useCallback(
    async (fn, failMsg) => {
      try {
        const idx = await loadIndex();
        idx.forEach((d) => {
          if (!d.notes) d.notes = [];
        });
        const result = fn(idx);
        await saveIndex(idx);
        setDays([...idx]);
        return result;
      } catch {
        if (failMsg) say(failMsg);
      }
    },
    [say]
  );

  const addFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        say("Only image files land here.");
        return;
      }
      setBusy(true);
      try {
        const date = todayStr();
        const prepared = [];
        for (const f of files) {
          try {
            const { data, w, h } = await compressFile(f);
            const id = uid();
            const res = await window.storage.set(`img:${date}:${id}`, data);
            if (!res) throw new Error("save failed");
            prepared.push({ id, w, h, tags: [] });
          } catch {
            say(`Couldn't add ${f.name}`);
          }
        }
        if (prepared.length) {
          await mutateIndex((idx) => {
            let dayEntry = idx.find((d) => d.date === date);
            if (!dayEntry) {
              dayEntry = { date, images: [], notes: [] };
              idx.unshift(dayEntry);
              idx.sort((a, b) => (a.date < b.date ? 1 : -1));
            }
            dayEntry.images.push(...prepared);
          });
          say(prepared.length === 1 ? "Added to today." : `Added ${prepared.length} to today.`);
        }
      } finally {
        setBusy(false);
      }
    },
    [mutateIndex, say]
  );

  const deleteImage = useCallback(
    async (date, id) => {
      let wasDemo = false;
      await mutateIndex((idx) => {
        const d = idx.find((x) => x.date === date);
        wasDemo = Boolean(d?.images.find((m) => m.id === id)?.demo);
        if (d) d.images = d.images.filter((m) => m.id !== id);
        const keep = idx.filter((x) => x.images.length > 0 || (x.notes || []).length > 0 || x.date === todayStr());
        idx.length = 0;
        idx.push(...keep);
      }, "Couldn't remove that image.");
      if (!wasDemo) {
        try {
          await window.storage.delete(`img:${date}:${id}`);
        } catch {}
      }
    },
    [mutateIndex]
  );

  const patchImage = useCallback(
    (date, id, patch) =>
      mutateIndex((idx) => {
        const m = idx.find((d) => d.date === date)?.images.find((x) => x.id === id);
        if (!m) return;
        Object.assign(m, patch);
        if (patch.product === null) delete m.product;
        if (patch.page === null) delete m.page;
      }, "Couldn't save changes."),
    [mutateIndex]
  );

  const saveTags = useCallback((date, id, tags) => patchImage(date, id, { tags }), [patchImage]);
  const saveProduct = useCallback(
    (date, id, product) => {
      patchImage(date, id, { product });
      say(product ? "Product linked." : "Product unlinked.");
    },
    [patchImage, say]
  );
  const saveCaption = useCallback((date, id, cap) => patchImage(date, id, { cap }), [patchImage]);
  const linkPage = useCallback(
    (date, id, page) => {
      patchImage(date, id, { page });
      say(page ? "Page linked." : "Page unlinked.");
    },
    [patchImage, say]
  );

  // freeform layout persistence: on first drag in a day, materialize every position
  const persistLayout = useCallback(
    (date, id, kind, pos, layout) =>
      mutateIndex((idx) => {
        const d = idx.find((x) => x.date === date);
        if (!d) return;
        for (const m of d.images) {
          const p = m.id === id && kind === "img" ? pos : layout.get(m.id);
          if (p) {
            m.fx = p.fx;
            m.fy = p.fy;
            m.fw = p.fw;
          }
        }
        for (const n of d.notes || []) {
          const p = n.id === id && kind === "note" ? pos : layout.get(n.id);
          if (p) {
            n.fx = p.fx;
            n.fy = p.fy;
            n.fw = p.fw;
          }
        }
      }),
    [mutateIndex]
  );

  const cycleSize = useCallback(
    (date, id, layout) =>
      mutateIndex((idx) => {
        const d = idx.find((x) => x.date === date);
        const m = d?.images.find((x) => x.id === id);
        if (!d || !m) return;
        // materialize first so nothing jumps
        for (const im of d.images) {
          const p = layout.get(im.id);
          if (p && im.fx == null) {
            im.fx = p.fx;
            im.fy = p.fy;
            im.fw = p.fw;
          }
        }
        const cur = m.fw ?? 30;
        const next = SIZES[(SIZES.findIndex((s) => s >= cur - 1) + 1) % SIZES.length] ?? SIZES[0];
        m.fw = next;
        m.fx = clamp(m.fx ?? 4, 0, 100 - next);
      }),
    [mutateIndex]
  );

  // notes
  const addNote = useCallback(
    (date) =>
      mutateIndex((idx) => {
        let d = idx.find((x) => x.date === date);
        if (!d) {
          d = { date, images: [], notes: [] };
          idx.unshift(d);
          idx.sort((a, b) => (a.date < b.date ? 1 : -1));
        }
        d.notes = d.notes || [];
        d.notes.push({ id: uid(), text: "New note — click ✎ to edit, drag to place.", fx: 4, fy: 2 + d.notes.length * 6, fw: 28 });
      }),
    [mutateIndex]
  );
  const editNoteText = useCallback(
    (date, id, text) =>
      mutateIndex((idx) => {
        const n = idx.find((d) => d.date === date)?.notes?.find((x) => x.id === id);
        if (n) n.text = text || "…";
      }),
    [mutateIndex]
  );
  const deleteNote = useCallback(
    (date, id) =>
      mutateIndex((idx) => {
        const d = idx.find((x) => x.date === date);
        if (d) d.notes = (d.notes || []).filter((n) => n.id !== id);
      }),
    [mutateIndex]
  );

  // ---------- pages ----------
  const createPageAndLink = useCallback(
    async (date, id, title) => {
      try {
        const pgs = await loadPages();
        let slug = slugify(title);
        let n = 2;
        while (pgs.some((p) => p.slug === slug)) slug = `${slugify(title)}-${n++}`;
        pgs.push({ slug, title, subtitle: "", body: "", images: [] });
        await savePages(pgs);
        setPages([...pgs]);
        await patchImage(date, id, { page: slug });
        openPageHash(slug);
        say("Page created — hit Edit page to fill it in.");
      } catch {
        say("Couldn't create that page.");
      }
    },
    [patchImage, say]
  );

  const patchPage = useCallback(async (slug, patch) => {
    setPages((pgs) => pgs.map((p) => (p.slug === slug ? { ...p, ...patch } : p)));
    try {
      const pgs = await loadPages();
      const p = pgs.find((x) => x.slug === slug);
      if (!p) return;
      Object.assign(p, patch);
      await savePages(pgs);
    } catch {}
  }, []);

  const addPageImages = useCallback(
    async (slug, fileList) => {
      const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      setBusy(true);
      try {
        const pgs = await loadPages();
        const p = pgs.find((x) => x.slug === slug);
        if (!p) return;
        let added = 0;
        for (const f of files) {
          try {
            const { data, w, h } = await compressFile(f);
            const id = uid();
            const res = await window.storage.set(`pgimg:${slug}:${id}`, data);
            if (!res) throw new Error("save failed");
            p.images.push({ id, w, h });
            added++;
          } catch {
            say(`Couldn't add ${f.name}`);
          }
        }
        await savePages(pgs);
        setPages([...pgs]);
        if (added) say(`Added ${added} to the page.`);
      } finally {
        setBusy(false);
      }
    },
    [say]
  );

  const removePageImage = useCallback(async (slug, id) => {
    try {
      const pgs = await loadPages();
      const p = pgs.find((x) => x.slug === slug);
      if (!p) return;
      const wasDemo = p.images.find((m) => m.id === id)?.demo;
      p.images = p.images.filter((m) => m.id !== id);
      await savePages(pgs);
      if (!wasDemo) {
        try {
          await window.storage.delete(`pgimg:${slug}:${id}`);
        } catch {}
      }
      setPages([...pgs]);
    } catch {}
  }, []);

  const deletePage = useCallback(
    async (slug) => {
      try {
        const pgs = await loadPages();
        const p = pgs.find((x) => x.slug === slug);
        if (p) {
          for (const m of p.images) {
            if (!m.demo) {
              try {
                await window.storage.delete(`pgimg:${slug}:${m.id}`);
              } catch {}
            }
          }
        }
        const left = pgs.filter((x) => x.slug !== slug);
        await savePages(left);
        setPages([...left]);
        await mutateIndex((idx) =>
          idx.forEach((d) =>
            d.images.forEach((m) => {
              if (m.page === slug) delete m.page;
            })
          )
        );
        closePageHash();
        say("Page deleted.");
      } catch {
        say("Couldn't delete that page.");
      }
    },
    [mutateIndex, say]
  );

  // ---------- backup ----------
  const exportBackup = useCallback(async () => {
    setBusy(true);
    try {
      const idx = await loadIndex();
      const pgs = await loadPages();
      const backup = await buildBackup(idx, pgs);
      if (!backup.days.length && !backup.pages.length) {
        say("Nothing to export yet — demo placeholders aren't archived.");
        return;
      }
      downloadJSON(backup, `daylog-backup-${todayStr()}.json`);
      say("Backup exported.");
    } catch {
      say("Export failed.");
    } finally {
      setBusy(false);
    }
  }, [say]);

  const importBackup = useCallback(
    async (file) => {
      setBusy(true);
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        if (backup.app !== "daylog" || !Array.isArray(backup.days)) throw new Error("bad file");
        const idx = await loadIndex();
        const have = new Set();
        idx.forEach((d) => d.images.forEach((m) => have.add(m.id)));
        let added = 0;
        for (const bd of backup.days) {
          let dayEntry = idx.find((d) => d.date === bd.date);
          if (!dayEntry) {
            dayEntry = { date: bd.date, images: [], notes: bd.notes || [] };
            idx.push(dayEntry);
          }
          for (const m of bd.images) {
            if (have.has(m.id) || !m.data) continue;
            await window.storage.set(`img:${bd.date}:${m.id}`, m.data);
            const { data, ...meta } = m;
            dayEntry.images.push(meta);
            added++;
          }
        }
        idx.sort((a, b) => (a.date < b.date ? 1 : -1));
        await saveIndex(idx);
        setDays([...idx]);
        if (Array.isArray(backup.pages)) {
          const pgs = await loadPages();
          for (const bp of backup.pages) {
            let p = pgs.find((x) => x.slug === bp.slug);
            if (!p) {
              p = { slug: bp.slug, title: bp.title, subtitle: bp.subtitle || "", body: bp.body || "", images: [] };
              pgs.push(p);
            }
            const haveP = new Set(p.images.map((m) => m.id));
            for (const m of bp.images || []) {
              if (haveP.has(m.id) || !m.data) continue;
              await window.storage.set(`pgimg:${bp.slug}:${m.id}`, m.data);
              p.images.push({ id: m.id, w: m.w, h: m.h });
            }
          }
          await savePages(pgs);
          setPages([...pgs]);
        }
        say(added ? `Restored ${added} image${added === 1 ? "" : "s"} + pages.` : "Nothing new to restore.");
      } catch {
        say("That doesn't look like a Daylog backup file.");
      } finally {
        setBusy(false);
      }
    },
    [say]
  );

  // ---------- global drag & drop (file uploads; owner, feed view only) ----------
  useEffect(() => {
    if (!canEdit) return;
    const enter = (e) => {
      if (routeRef.current) return;
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }
    };
    const over = (e) => {
      if (routeRef.current) return;
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (e) => {
      if (routeRef.current) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles, canEdit]);

  // keyboard: esc · login shortcut
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") {
        if (detail) {
          setDetail(null);
          return;
        }
        if (routeRef.current) closePageHash();
        setLoginOpen(false);
        setEditing(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        requestLoginToggle();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [requestLoginToggle, detail]);

  const pick = () => fileRef.current?.click();

  // mobile login: 5 quick taps on the wordmark
  const tapRef = useRef({ n: 0, t: 0 });
  const markTap = () => {
    const now = Date.now();
    if (now - tapRef.current.t > 2500) tapRef.current.n = 0;
    tapRef.current.t = now;
    tapRef.current.n += 1;
    if (tapRef.current.n >= 5) {
      tapRef.current.n = 0;
      requestLoginToggle();
    }
  };

  // live meta for the open detail (stays fresh after edits)
  const detailMeta = detail && days ? days.find((d) => d.date === detail.date)?.images.find((m) => m.id === detail.id) : null;

  // ---------- routed views ----------
  if (route) {
    return (
      <div className="dl-root">
        <style>{css}</style>
        {route.kind === "work" ? (
          <WorkIndex pages={pages} onOpen={openPageHash} />
        ) : route.kind === "about" ? (
          <AboutPage
            canEdit={canEdit}
            pages={pages}
            onOpenPage={openPageHash}
            onExport={exportBackup}
            onImport={importBackup}
          />
        ) : (
          <PageView
            slug={route.slug}
            pages={pages}
            canEdit={canEdit}
            onBack={closePageHash}
            onPatch={patchPage}
            onAddImages={addPageImages}
            onRemoveImage={removePageImage}
            onDeletePage={deletePage}
          />
        )}
        {busy && <div className="dl-busy">Working…</div>}
        {toast && <div className="dl-toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="dl-root">
      <style>{css}</style>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

      <header className="dl-top">
        <div className="dl-toprow">
          <span className="dl-mark" onClick={markTap}>{SITE_NAME}</span>
          <span className="dl-tagline">{SITE_TAGLINE}</span>
          <nav className="dl-topright">
            {canEdit && <button className="dl-add" onClick={pick}>+ Add</button>}
            <button className="dl-navlink" onClick={openWorkHash}>Works</button>
            <button className="dl-navlink" onClick={openAboutHash}>About</button>
          </nav>
        </div>

      </header>

      <h1 className="dl-hero">
        {SITE_HERO[0]}
        <br />
        {SITE_HERO[1]}
      </h1>

      <main className="dl-scroll">
        {filterOn && viewDays && (
          <p className="dl-filternote">
            {matchCount === 0 ? "No images match this filter." : `${matchCount} image${matchCount === 1 ? "" : "s"} tagged ${filter.join(", ")}`}{" "}
            <button className="dl-clear" onClick={() => setFilter([])}>Clear</button>
          </p>
        )}
        {viewDays === null ? (
          <p className="dl-loading">Loading the days…</p>
        ) : (
          viewDays.map((d) => (
            <DayCanvas
              key={d.date}
              day={d}
              isToday={d.date === today}
              canEdit={canEdit}
              filterOn={filterOn}
              isMobile={isMobile}
              pages={pages}
              onPick={pick}
              onAddNote={addNote}
              onLayout={persistLayout}
              onOpenDetail={(date, m) => setDetail({ date, id: m.id })}
              onCycleSize={cycleSize}
              onDeleteImage={deleteImage}
              onEditNoteText={editNoteText}
              onDeleteNote={deleteNote}
              editing={editing}
              setEditing={setEditing}
              onSaveTags={saveTags}
              onSaveProduct={saveProduct}
              onLinkPage={linkPage}
              onCreatePage={createPageAndLink}
            />
          ))
        )}
        {viewDays && viewDays.length > 0 && !filterOn && <p className="dl-end">— beginning of the scroll —</p>}
      </main>

      {dragging && (
        <div className="dl-wash" aria-hidden="true">
          <div className="dl-wash-inner">
            <span className="dl-wash-title">Today</span>
            <span>Drop to add</span>
          </div>
        </div>
      )}

      {busy && <div className="dl-busy">Working…</div>}
      {toast && <div className="dl-toast">{toast}</div>}

      {detailMeta && (
        <DetailSplit
          date={detail.date}
          meta={detailMeta}
          pages={pages}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onSaveCaption={saveCaption}
          onShopBuy={(m) => m.product?.url && window.open(m.product.url, "_blank", "noopener")}
          onOpenPage={openPageHash}
          onTagClick={toggleTag}
        />
      )}

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSubmit={() => {
            setLoginOpen(false);
            applyMode("owner");
          }}
        />
      )}

      <Footer />
    </div>
  );
}

// ---------- styles ----------
const css = `
/* ---- type stack (embedded latin subsets) ----
   H1/H2: Frankie News (fallback Libre Franklin) · nav/labels: DEWD Cool Old Sign · body: TT2020 Style E */
@font-face {
  font-family: 'Frankie News';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'DEWD Cool Old Sign';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'TT2020 Style E';
  src: url(data:font/woff2;base64,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) format('woff2');
  font-display: swap;
}

:root {
  --paper: #f9f9f9;
  --ink: #111111;
  --mute: #9a9a96;
  --line: #e4e4e0;
  --block: #4d4d4d;
  --head: 'Frankie News', 'Libre Franklin', system-ui, sans-serif;
  --sign: 'DEWD Cool Old Sign', 'Libre Franklin', sans-serif;
  --type: 'TT2020 Style E', 'Courier New', monospace;
}
* { box-sizing: border-box; }
.dl-root {
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--type);
  font-size: 15px;
  line-height: 1.6;
}
button { font-family: inherit; }

/* ===== top bar ===== */
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
.dl-top { position: sticky; top: 0; z-index: 30; background: var(--paper); }
.dl-toprow {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 22px 48px 16px;
}
.dl-mark {
  font-family: var(--sign); font-size: 15px; letter-spacing: 0.14em;
  text-transform: uppercase; cursor: default; user-select: none;
}
.dl-tagline {
  position: absolute; left: 50%; transform: translateX(-50%);
  font-family: var(--type); font-size: 10.5px; letter-spacing: 0.08em;
  color: var(--mute); white-space: nowrap;
}
@media (max-width: 900px) { .dl-tagline { display: none; } }
.dl-topright { display: flex; align-items: center; gap: 26px; }
.dl-navlink {
  font-family: var(--sign); font-size: 13px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--ink);
  background: none; border: none; padding: 4px 0; cursor: pointer;
}
.dl-navlink:hover { text-decoration: underline; text-underline-offset: 5px; }
.dl-add {
  font-family: var(--sign); font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
  cursor: pointer; padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--ink); background: var(--ink); color: var(--paper);
}
.dl-add:hover { background: #000; }
.dl-navlink:focus-visible, .dl-add:focus-visible, .dl-filtericon:focus-visible,
.dl-chip:focus-visible, .dl-clear:focus-visible, .dl-stage:focus-visible,
.dl-act:focus-visible, .dl-modal-x:focus-visible, .dl-minitag:focus-visible,
.dl-back:focus-visible, .dl-crumb:focus-visible, .dl-buy:focus-visible,
.dl-backup-btn:focus-visible, .dl-work-card:focus-visible, .dl-login-btn:focus-visible {
  outline: 2px solid var(--ink); outline-offset: 2px;
}

/* filter icon + bar */
.dl-filtericon {
  position: relative; width: 32px; height: 32px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--ink); cursor: pointer;
}
.dl-filtericon:hover { background: #ececea; }
.dl-filtericon-on { background: var(--ink); color: var(--paper); }
.dl-filtericon-on:hover { background: #000; color: var(--paper); }
.dl-filterbadge {
  position: absolute; top: -4px; right: -4px;
  min-width: 15px; height: 15px; padding: 0 4px;
  border-radius: 999px; background: var(--ink); color: var(--paper);
  border: 1px solid var(--paper);
  font-family: var(--type); font-size: 9px; line-height: 13px;
}
.dl-filterbar {
  display: flex; gap: 8px; align-items: center;
  margin: 6px 48px 0; padding: 10px 0;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  overflow-x: auto; scrollbar-width: none;
}
.dl-filterbar::-webkit-scrollbar { display: none; }
.dl-chip {
  font-family: var(--sign); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  cursor: pointer; white-space: nowrap;
  padding: 5px 12px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--paper); color: var(--ink);
  display: inline-flex; align-items: center; gap: 6px;
}
.dl-chip:hover { border-color: var(--ink); }
.dl-chip-on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.dl-chip-n { font-family: var(--type); font-size: 10px; opacity: .65; }
.dl-chip button { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
.dl-clear {
  font-family: var(--type); font-size: 12px; cursor: pointer; white-space: nowrap;
  background: none; border: none; color: var(--mute);
  text-decoration: underline; text-underline-offset: 3px;
}
.dl-clear:hover { color: var(--ink); }
.dl-filternote { font-family: var(--type); font-size: 13px; color: var(--mute); margin: 0 0 26px; }

/* ===== hero ===== */
.dl-hero {
  font-family: var(--head);
  font-size: clamp(40px, 5.6vw, 84px);
  line-height: 0.98; letter-spacing: 0.01em;
  text-transform: uppercase; text-align: center;
  margin: 26px auto 64px; padding: 0 24px; max-width: 1100px;
}

/* ===== scroll of days ===== */
.dl-scroll { max-width: 1840px; margin: 0 auto; padding: 0 48px 140px; }
@media (max-width: 700px) { .dl-scroll { padding: 0 24px 70px; } .dl-toprow { padding: 22px 24px 8px; } .dl-filterbar { margin: 6px 24px 0; } }
.dl-loading, .dl-end {
  font-family: var(--type); color: var(--mute); text-align: center; font-size: 13px;
  padding: 46px 0; letter-spacing: 0.06em;
}
.dl-day { margin-bottom: 84px; }
.dl-dayhead {
  position: sticky; top: 62px; z-index: 12;
  display: flex; align-items: baseline; gap: 16px;
  margin-bottom: 22px; padding: 8px 0;
  background: var(--paper);
}
@media (max-width: 700px) { .dl-dayhead { top: 58px; } }
.dl-daylabel {
  font-family: var(--sign); font-size: 14px; letter-spacing: 0.16em;
  text-transform: uppercase;
}
.dl-addnote {
  font-family: var(--sign); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--mute); background: none; border: none; cursor: pointer; padding: 2px 8px; border-radius: 999px;
}
.dl-addnote:hover { color: var(--ink); background: #ececea; }
.dl-count { margin-left: auto; font-family: var(--type); font-size: 12px; color: var(--mute); }

/* today's empty stage */
.dl-stage {
  width: 100%; min-height: 300px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  border: 1px dashed #cfcfcb; border-radius: 4px;
  background: transparent; color: var(--ink); font-family: var(--type); font-size: 15px;
}
.dl-stage:hover { border-color: var(--ink); background: #f2f2f0; }
.dl-stage-title { font-family: var(--sign); letter-spacing: 0.16em; text-transform: uppercase; font-size: 15px; }
.dl-stage-sub { font-size: 12px; color: var(--mute); }

/* ===== images: shared box + caption ===== */
.dl-imgbox {
  position: relative; display: block; width: 100%;
  background: var(--block); overflow: hidden;
}
.dl-imgbox img { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; animation: dl-in .6s ease both; }
@keyframes dl-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dl-imgbox img { animation: none; } }
.dl-itemcap {
  font-family: var(--type); font-size: 11px; line-height: 1.5;
  color: var(--mute); margin: 8px 0 0; max-width: 52ch;
}
.dl-ph { position: absolute; inset: 0; background: var(--block); }
.dl-ph-x { display: flex; align-items: center; justify-content: center; color: #8a8a8a; font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .dl-imgbox img { animation: none; } }

/* stacked flow (mobile & filtered) */
.dl-grid { column-count: 3; column-gap: 20px; }
@media (max-width: 860px) { .dl-grid { column-count: 2; } }
@media (max-width: 540px) { .dl-grid { column-count: 1; } }
.dl-fig { position: relative; margin: 0 0 26px; break-inside: avoid; cursor: pointer; }
.dl-note-flat { break-inside: avoid; margin: 0 0 26px; }

/* ===== freeform canvas ===== */
.dl-canvas { position: relative; width: 100%; }
.dl-item { position: absolute; margin: 0; }
.dl-item-img { cursor: pointer; }
.dl-canvas-edit .dl-item { cursor: grab; touch-action: none; }
.dl-item-drag { cursor: grabbing !important; }
.dl-item-drag .dl-imgbox { box-shadow: 0 14px 40px rgba(0,0,0,.22); }
.dl-item-note { padding: 2px; }
.dl-note-text { margin: 0; font-family: var(--type); font-size: 15px; line-height: 1.7; color: var(--ink); white-space: pre-wrap; }
.dl-note-edit {
  width: 100%; font-family: var(--type); font-size: 14px; line-height: 1.6; color: var(--ink);
  border: 1px solid var(--ink); border-radius: 4px; background: var(--paper);
  padding: 8px; resize: vertical; outline: none;
}
.dl-note-actions { top: -30px; right: 0; }

/* ===== hover reveal ===== */
.dl-hoverbar {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 26px 12px 10px;
  background: linear-gradient(to top, rgba(0,0,0,.6), rgba(0,0,0,0));
  color: #fff;
  opacity: 0; transform: translateY(6px);
  transition: opacity .18s ease, transform .18s ease;
  pointer-events: none;
}
.dl-item-img:hover .dl-hoverbar, .dl-fig:hover .dl-hoverbar { opacity: 1; transform: translateY(0); }
@media (hover: none) { .dl-hoverbar { display: none; } }
.dl-hoverbar-text { font-family: var(--type); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-hoverbar-text em { font-style: normal; font-family: var(--sign); opacity: .85; margin-left: 6px; }
.dl-hoverbar-btn {
  font-family: var(--sign); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  background: var(--paper); color: var(--ink);
  padding: 5px 12px; border-radius: 999px; white-space: nowrap;
}

/* ===== per-image owner actions ===== */
.dl-fig-actions {
  position: absolute; top: 8px; right: 8px;
  display: flex; gap: 6px;
  opacity: 0; transition: opacity .15s; z-index: 3;
}
.dl-imgbox:hover .dl-fig-actions, .dl-item:hover .dl-fig-actions,
.dl-fig-editing .dl-fig-actions, .dl-fig-actions:focus-within { opacity: 1; }
@media (hover: none) { .dl-fig-actions { opacity: 1; } }
.dl-act {
  width: 26px; height: 26px; border-radius: 50%;
  border: none; cursor: pointer; font-size: 13px; line-height: 1;
  background: rgba(0,0,0,.55); color: #fff;
}
.dl-act:hover { background: rgba(0,0,0,.85); }
.dl-act-on { background: #000; outline: 1px solid #fff; }
.dl-minitag {
  font-family: var(--sign); font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  cursor: pointer; padding: 4px 10px; border-radius: 999px; border: none;
  background: #ececea; color: var(--ink);
}
.dl-minitag:hover { background: var(--ink); color: var(--paper); }

/* editors */
.dl-tagedit, .dl-prodedit {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;
  background: rgba(249,249,249,.97);
  border-top: 1px solid var(--ink);
  padding: 10px; display: flex; flex-direction: column; gap: 6px;
}
.dl-tagedit-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dl-tagedit input, .dl-prodedit input {
  font-family: var(--type); font-size: 12px; border: none; border-bottom: 1px solid var(--line);
  outline: none; background: transparent; color: var(--ink);
  min-width: 90px; flex: 1; padding: 4px 2px;
}
.dl-tagedit input:focus, .dl-prodedit input:focus { border-bottom-color: var(--ink); }
.dl-tagedit input::placeholder, .dl-prodedit input::placeholder { color: var(--mute); }
.dl-tagedit-done, .dl-prodedit-save, .dl-prodedit-remove {
  align-self: flex-end; font-family: var(--sign); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  cursor: pointer; background: none; border: none; padding: 0;
  text-decoration: underline; text-underline-offset: 3px; color: var(--mute);
}
.dl-tagedit-done:hover, .dl-prodedit-remove:hover { color: var(--ink); }
.dl-prodedit-save { color: var(--ink); }
.dl-prodedit-row { display: flex; justify-content: flex-end; gap: 14px; margin-top: 2px; }
.dl-pagepick {
  font-family: var(--type); font-size: 12px; color: var(--ink);
  border: 1px solid var(--line); border-radius: 4px;
  background: var(--paper); padding: 6px 8px;
}

/* ===== breadcrumbs ===== */
.dl-crumbs { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dl-crumb-wrap { display: inline-flex; align-items: center; gap: 10px; }
.dl-crumb-sep { color: var(--mute); font-size: 12px; }
.dl-crumb {
  font-family: var(--sign); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
  cursor: pointer; border: none; background: none; padding: 4px 0; color: var(--ink);
}
.dl-crumb:hover { text-decoration: underline; text-underline-offset: 5px; }
.dl-crumb-here { cursor: default; color: var(--mute); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ===== work index ===== */
.dl-page { min-height: 100vh; display: flex; flex-direction: column; background: var(--paper); }
.dl-page-top {
  position: sticky; top: 0; z-index: 30; background: var(--paper);
  display: flex; justify-content: space-between; align-items: center;
  padding: 22px 48px 16px;
}
.dl-page-tools { display: flex; gap: 8px; }
.dl-back {
  font-family: var(--sign); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
  cursor: pointer; padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--paper); color: var(--ink);
}
.dl-back:hover { border-color: var(--ink); }
.dl-del-confirm { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.dl-work { flex: 1; width: 100%; max-width: 1840px; margin: 0 auto; padding: 10px 48px 140px; }
.dl-work-title {
  font-family: var(--head); font-size: clamp(40px, 5vw, 72px);
  text-transform: uppercase; text-align: center; letter-spacing: 0.01em;
  line-height: 1; margin: 10px 0 54px;
}
.dl-work-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 44px 36px; }
@media (max-width: 1000px) { .dl-work-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) { .dl-work-grid { grid-template-columns: 1fr; } }
.dl-work-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
  text-align: left; cursor: pointer; background: none; border: none; padding: 0; color: var(--ink);
}
.dl-work-cover { position: relative; display: block; width: 100%; background: var(--block); overflow: hidden; }
.dl-work-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dl-work-cover-ph { position: absolute; inset: 0; background: var(--block); }
.dl-work-card-title {
  font-family: var(--head); font-size: clamp(22px, 2vw, 30px); line-height: 1.05;
  text-transform: uppercase; letter-spacing: 0.01em;
}
.dl-work-card-snip { font-family: var(--type); font-size: 13.5px; line-height: 1.6; color: #333; }
.dl-work-card-more {
  font-family: var(--sign); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  border-bottom: 2px solid var(--ink); padding-bottom: 2px; margin-top: 2px;
}
.dl-work-card:hover .dl-work-card-title { text-decoration: underline; text-underline-offset: 5px; }

/* ===== deeper-dive page ===== */
.dl-page-body { flex: 1; width: 100%; max-width: 980px; margin: 0 auto; padding: 24px 48px 150px; }
.dl-page-title {
  font-family: var(--head); font-size: clamp(34px, 5vw, 64px);
  text-transform: uppercase; letter-spacing: 0.01em; line-height: 1.02; margin: 0 0 10px;
}
.dl-page-sub { font-family: var(--type); font-size: 13px; color: var(--mute); margin: 0 0 26px; }
.dl-page-text { font-family: var(--type); max-width: 66ch; margin: 0 0 16px; color: #222; }
.dl-page-imgs { margin-top: 38px; display: flex; flex-direction: column; gap: 26px; }
.dl-page-fig { cursor: default; }
.dl-page-add { min-height: 140px; margin-top: 26px; font-size: 14px; }
.dl-page-title-input, .dl-page-sub-input, .dl-page-text-input {
  display: block; width: 100%; font-family: var(--type); color: var(--ink); background: transparent;
  border: none; border-bottom: 1px solid var(--line); outline: none; padding: 6px 0; margin-bottom: 14px;
}
.dl-page-title-input { font-family: var(--head); font-size: clamp(26px, 4vw, 44px); text-transform: uppercase; }
.dl-page-sub-input { font-size: 13px; color: var(--mute); }
.dl-page-text-input { font-size: 15px; line-height: 1.6; resize: vertical; border: 1px solid var(--line); border-radius: 4px; padding: 10px; }
.dl-page-title-input:focus, .dl-page-sub-input:focus, .dl-page-text-input:focus { border-color: var(--ink); }

/* ===== about ===== */
.dl-about { flex: 1; width: 100%; max-width: 1840px; margin: 0 auto; padding: 10px 48px 140px; }
.dl-about-title { margin-bottom: 54px; }
.dl-about-cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 60px; align-items: start; }
@media (max-width: 860px) { .dl-about-cols { grid-template-columns: 1fr; gap: 30px; } }
.dl-about-img { background: var(--block); aspect-ratio: 6 / 5; width: 100%; }
.dl-about-text { font-family: var(--type); font-size: 15px; line-height: 1.75; max-width: 62ch; padding-top: 40px; }
.dl-about-text p { margin: 0 0 22px; }
.dl-about-hello { font-style: italic; }
.dl-about-mail { color: var(--ink); text-decoration-color: var(--ink); text-underline-offset: 3px; }
.dl-about-owner { border-top: 1px solid var(--line); margin-top: 40px; padding-top: 24px; }
.dl-pagelist a { color: var(--ink); text-decoration-color: var(--ink); text-underline-offset: 3px; }

/* ===== footer ===== */
.dl-footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 25;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 48px 18px; pointer-events: none;
}
.dl-footer a, .dl-footer span { pointer-events: auto; }
@media (max-width: 700px) { .dl-footer { padding: 12px 24px 14px; } }
.dl-footer-c { font-family: var(--sign); font-size: 13px; letter-spacing: 0.14em; }
.dl-footer-links { display: flex; gap: 18px; }
.dl-footer-links a {
  font-family: var(--sign); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink); text-decoration: none;
}
.dl-footer-links a:hover { text-decoration: underline; text-underline-offset: 4px; }

/* ===== split-screen detail ===== */
.dl-split { position: fixed; inset: 0; z-index: 70; display: flex; background: var(--paper); }
.dl-split-img { position: relative; flex: 1 1 62%; display: flex; align-items: center; justify-content: center; padding: 44px; min-width: 0; }
.dl-split-img img { max-width: 100%; max-height: calc(100vh - 88px); object-fit: contain; display: block; }
.dl-split-info { flex: 0 0 360px; max-width: 40%; border-left: 1px solid var(--line); padding: 64px 34px 30px; overflow-y: auto; }
.dl-split-x { position: fixed; top: 14px; right: 16px; z-index: 71; background: var(--paper); }
.dl-split-date { font-family: var(--sign); font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--mute); margin: 0 0 14px; }
.dl-split-cap { font-family: var(--type); font-size: 15px; line-height: 1.7; margin: 0 0 18px; }
.dl-split-capedit {
  width: 100%; font-family: var(--type); font-size: 14px; line-height: 1.6; color: var(--ink);
  border: 1px solid var(--line); border-radius: 4px; background: var(--paper);
  padding: 8px; resize: vertical; outline: none; margin-bottom: 18px;
}
.dl-split-capedit:focus { border-color: var(--ink); }
.dl-split-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 22px; }
.dl-split-block { border-top: 1px solid var(--line); padding-top: 16px; margin-top: 4px; margin-bottom: 18px; }
.dl-split-label { font-family: var(--sign); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--mute); margin: 0 0 8px; }
.dl-split-prodname { font-family: var(--head); text-transform: uppercase; font-size: 18px; margin: 0 0 2px; }
.dl-shopprice { font-family: var(--type); font-size: 15px; margin: 0 0 8px; }
.dl-shopnote { font-family: var(--type); font-size: 12px; color: var(--mute); margin: 8px 0 0; }
.dl-split-pagelink {
  font-family: var(--head); text-transform: uppercase; font-size: 20px; color: var(--ink);
  background: none; border: none; padding: 0; cursor: pointer; text-align: left;
}
.dl-split-pagelink:hover { text-decoration: underline; text-underline-offset: 4px; }
.dl-buy {
  display: inline-flex; align-items: center; margin-top: 4px;
  font-family: var(--sign); font-size: 12px; letter-spacing: .1em; text-transform: uppercase;
  text-decoration: none; padding: 11px 20px; border-radius: 999px;
  background: var(--ink); color: var(--paper); border: none; cursor: pointer;
}
.dl-buy:hover { background: #000; }
@media (max-width: 700px) {
  .dl-split { flex-direction: column; overflow-y: auto; }
  .dl-split-img { flex: none; padding: 54px 16px 10px; }
  .dl-split-img img { max-height: 60vh; }
  .dl-split-info { flex: none; max-width: none; border-left: none; border-top: 1px solid var(--line); padding: 22px 20px 60px; }
}

/* ===== drop wash / toasts ===== */
.dl-wash { position: fixed; inset: 0; z-index: 40; pointer-events: none; background: rgba(249,249,249,.93); display: flex; align-items: center; justify-content: center; }
.dl-wash-inner {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  font-family: var(--type); font-size: 16px;
  border: 2px dashed var(--ink); border-radius: 8px; padding: 56px 80px; background: var(--paper);
}
.dl-wash-title { font-family: var(--sign); letter-spacing: .16em; text-transform: uppercase; font-size: 18px; }
.dl-toast, .dl-busy {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
  z-index: 80; font-family: var(--type); font-size: 13px;
  background: var(--ink); color: var(--paper); padding: 9px 18px; border-radius: 999px;
}
.dl-busy { bottom: 62px; background: var(--paper); color: var(--ink); border: 1px solid var(--ink); }

/* ===== modal shell (login) ===== */
.dl-modal-veil { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.42); display: flex; align-items: center; justify-content: center; padding: 20px; }
.dl-modal {
  position: relative; max-width: 460px; width: 100%; max-height: 86vh; overflow-y: auto;
  background: var(--paper); border-radius: 8px; padding: 34px 34px 30px;
  box-shadow: 0 24px 60px rgba(0,0,0,.2);
}
.dl-modal h2 { font-family: var(--head); text-transform: uppercase; margin: 0 0 12px; font-size: 26px; }
.dl-modal-x {
  position: absolute; top: 12px; right: 14px; width: 30px; height: 30px; border-radius: 50%;
  border: none; background: transparent; cursor: pointer; font-size: 20px; color: var(--mute);
}
.dl-modal-x:hover { color: var(--ink); }
.dl-hint { margin-top: 18px; font-family: var(--type); font-size: 11px; color: var(--mute); letter-spacing: 0.02em; }
.dl-backup-row { display: flex; gap: 10px; margin: 4px 0 18px; align-items: center; }
.dl-backup-btn {
  font-family: var(--sign); font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  cursor: pointer; padding: 9px 16px; border-radius: 999px;
  border: 1px solid var(--ink); background: var(--paper); color: var(--ink);
}
.dl-backup-btn:hover { background: var(--ink); color: var(--paper); }
.dl-login { max-width: 340px; }
.dl-login-input {
  display: block; width: 100%; font-family: var(--type); font-size: 15px; color: var(--ink);
  border: 1px solid var(--line); border-radius: 4px; padding: 11px 12px; margin: 14px 0 12px;
  outline: none; background: var(--paper);
}
.dl-login-input:focus { border-color: var(--ink); }
.dl-login-btn { width: 100%; justify-content: center; }
`;

