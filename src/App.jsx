import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as be from "./backend.js";
import { fourthwallEnabled, getAllProducts, checkoutUrl } from "./fourthwall.js";

/*
  FEED — deployed version.
  · Freeform day canvases: drag images & notes, invisible-grid snap, ⤢ sizes.
  · Split-screen detail on click (image left, info right).
  · Hover reveals product/caption info (fieldnotes-style).
  · Login modal (Supabase email+password, or passphrase in local preview).
  · Pages, Work index, breadcrumbs, tags/filter, Fourthwall as before.
  Requires migrate-v2.sql (cap/fx/fy/fw columns + notes table).
*/

const MAX_DIM = 1600;
const TARGET_BYTES = 1_800_000;
const PASS = import.meta.env.VITE_OWNER_PASSPHRASE || "";
const SNAP = 2;
const SIZES = [22, 32, 46, 64];
const SITE_NAME = "Derrick Kempf";
const SITE_TAGLINE = "Artist & Brand Identity Designer";
const SITE_HERO = ["Art feed"];
const SOCIALS = [
  { label: "X", url: "https://x.com/derrickkempf" },
  { label: "Instagram", url: "https://instagram.com/derrickkempf" },
  { label: "LinkedIn", url: "https://www.linkedin.com/in/derrickkempf" },
];

// ---------- helpers ----------
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
  const [y, m, d] = String(dateStr).split("-").map(Number);
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
const snapv = (v) => Math.round(v / SNAP) * SNAP;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

function compressFile(file, maxDim = MAX_DIM) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const toBlob = (q) => new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
      (async () => {
        let q = 0.82;
        let blob = await toBlob(q);
        while (blob && blob.size > TARGET_BYTES && q > 0.4) {
          q -= 0.12;
          blob = await toBlob(q);
        }
        blob ? resolve({ blob, w, h }) : reject(new Error("encode failed"));
      })();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("read failed"));
    };
    img.src = url;
  });
}

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

function resolveLayout(day, cols) {
  const gap = 3;
  const colW = (100 - gap * (cols + 1)) / cols;
  const colY = new Array(cols).fill(0);
  const out = new Map();
  const colX = (c) => gap + c * (colW + gap);
  // reserve space under everything already placed by hand
  const reserve = (fx, fy, fw, fh) => {
    for (let c = 0; c < cols; c++) {
      if (fx < colX(c) + colW && fx + fw > colX(c)) {
        colY[c] = Math.max(colY[c], (fy || 0) + fh + gap);
      }
    }
  };
  for (const m of day.images) {
    if (m.fx != null) {
      const fw = m.fw ?? 30;
      const fh = fw / (m.w && m.h ? m.w / m.h : 4 / 3) + (m.cap ? 4 : 0);
      out.set(m.id, { fx: m.fx, fy: m.fy || 0, fw });
      reserve(m.fx, m.fy, fw, fh);
    }
  }
  for (const n of day.notes || []) {
    if (n.fx != null) {
      const fw = n.fw ?? 28;
      out.set(n.id, { fx: n.fx, fy: n.fy || 0, fw });
      reserve(n.fx, n.fy, fw, 10);
    }
  }
  // new items flow into the shortest remaining column, below placed work
  for (const m of day.images) {
    if (m.fx != null) continue;
    const c = colY.indexOf(Math.min(...colY));
    const fw = colW;
    const fy = colY[c];
    const fh = fw / (m.w && m.h ? m.w / m.h : 4 / 3) + (m.cap ? 4 : 0);
    colY[c] = fy + fh + gap;
    out.set(m.id, { fx: colX(c), fy, fw });
  }
  let noteStagger = 0;
  for (const n of day.notes || []) {
    if (n.fx != null) continue;
    const c = colY.indexOf(Math.min(...colY));
    out.set(n.id, { fx: colX(c), fy: colY[c], fw: n.fw ?? 28 });
    colY[c] += 12;
    noteStagger++;
  }
  return out;
}

// ---------- login modal ----------
function LoginModal({ localMode, onClose, onSubmit, error, busy }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  const go = () => onSubmit(localMode ? { pass } : { email: email.trim(), pass });
  return (
    <div className="dl-modal-veil" onClick={onClose}>
      <div className="dl-modal dl-login" role="dialog" aria-modal="true" aria-label="Log in" onClick={(e) => e.stopPropagation()}>
        <button className="dl-modal-x" aria-label="Close" onClick={onClose}>×</button>
        <h2>Log in</h2>
        <p className="dl-shopnote" style={{ marginBottom: 14 }}>Owner access — add, arrange, tag, link, and sell.</p>
        {!localMode && (
          <input
            ref={firstRef}
            className="dl-login-input"
            type="email"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
        )}
        <input
          ref={localMode ? firstRef : undefined}
          className="dl-login-input"
          type="password"
          placeholder={localMode ? "Passphrase" : "Password"}
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        {error && <p className="dl-login-err">{error}</p>}
        <button className="dl-login-btn" disabled={busy} onClick={go}>{busy ? "Signing in…" : "Log in"}</button>
      </div>
    </div>
  );
}

// ---------- split-screen detail ----------
function DetailSplit({ date, meta, pages, canEdit, onClose, onSaveCaption, onShopBuy, onOpenPage, onTagClick }) {
  const linkedPage = meta.page && pages.find((p) => p.slug === meta.page);
  const [cap, setCap] = useState(meta.cap || "");
  useEffect(() => setCap(meta.cap || ""), [meta.id, meta.cap]);
  return (
    <div className="dl-split" role="dialog" aria-modal="true" aria-label="Image detail">
      <button className="dl-modal-x dl-split-x" aria-label="Close" onClick={onClose}>×</button>
      <div className="dl-split-img">
        <img src={meta.url} alt={cap || ""} />
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

// ---------- editors ----------
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
  const [catalog, setCatalog] = useState(null);
  const nameRef = useRef(null);
  useEffect(() => {
    nameRef.current?.focus();
    if (!fourthwallEnabled()) {
      setCatalog([]);
      return;
    }
    let cancel = false;
    getAllProducts()
      .then((list) => !cancel && setCatalog(list))
      .catch(() => !cancel && setCatalog([]));
    return () => {
      cancel = true;
    };
  }, []);
  const pickCatalog = (slug) => {
    const prod = catalog?.find((c) => c.slug === slug);
    if (!prod) return;
    onSave(meta.id, { slug: prod.slug, variantId: prod.variantId, name: prod.name, price: prod.price, url: prod.url });
    onClose();
  };
  const save = () => {
    const clean = { name: name.trim(), price: price.trim(), url: url.trim() };
    onSave(meta.id, clean.name || clean.url ? clean : null);
    onClose();
  };
  return (
    <div className="dl-prodedit">
      {fourthwallEnabled() && (
        <select className="dl-pagepick" defaultValue="" onChange={(e) => pickCatalog(e.target.value)}>
          <option value="" disabled>{catalog === null ? "Loading your Fourthwall products…" : "Pick a Fourthwall product…"}</option>
          {(catalog || []).map((c) => (
            <option key={c.slug} value={c.slug}>{c.name} {c.price ? `— ${c.price}` : ""}</option>
          ))}
        </select>
      )}
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

// ---------- canvas items ----------
function CanvasImg({ meta, pos, canEdit, drag, resizing, onDragStart, onResizeStart, onOpen, onCycleSize, onSnip, onEdit, onDelete, editorOpen, editors }) {
  const isDragging = (drag && drag.id === meta.id) || resizing;
  const style = {
    left: `${pos.fx}%`,
    top: `${pos.top}px`,
    width: `${pos.fw}%`,
    transform: drag && drag.id === meta.id ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
    zIndex: isDragging ? 5 : undefined,
  };
  return (
    <figure
      className={`dl-item dl-item-img ${isDragging ? "dl-item-drag" : ""} ${editorOpen ? "dl-fig-editing" : ""}`}
      style={style}
      onPointerDown={(e) => canEdit && !editorOpen && onDragStart(e, meta.id, "img")}
      onClick={() => !editorOpen && onOpen(meta)}
    >
      <span className="dl-imgbox" style={{ aspectRatio: `${meta.w} / ${meta.h}` }}>
        <img src={meta.url} alt={meta.cap || ""} loading="lazy" draggable={false} />
        {!editorOpen && (meta.product || meta.page) && (
          <div className="dl-hoverbar">
            <span className="dl-hoverbar-text">
              {meta.product ? meta.product.name : "Project"}
              {meta.product?.price ? <em> {meta.product.price}</em> : null}
            </span>
            <span className="dl-hoverbar-btn">{meta.product ? "Shop" : "View"}</span>
          </div>
        )}
      {canEdit && !editorOpen && (
        <span
          className="dl-resize"
          title="Drag to scale"
          aria-label="Drag to scale image"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, meta.id, "img");
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      </span>
      {meta.cap && <figcaption className="dl-itemcap">{meta.cap}</figcaption>}
      {canEdit && !editorOpen && (
        <div className="dl-fig-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button className="dl-act" title="Cycle size" aria-label="Cycle size" onClick={() => onCycleSize(meta.id)}>⤢</button>
          <button className="dl-act" title="Save as reusable card" aria-label="Save as reusable card" onClick={() => onSnip(meta)}>☆</button>
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

// ---------- rich blocks ----------
// tiny inline markdown: **bold** · *italic* · [label](https://url)
function mdInline(text) {
  const out = [];
  let rest = String(text || "");
  let k = 0;
  const rx = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/;
  while (rest) {
    const m = rest.match(rx);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    if (m[2]) out.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[4]) out.push(<em key={k++}>{m[4]}</em>);
    else out.push(<a key={k++} href={m[7]} target="_blank" rel="noopener noreferrer">{m[6]}</a>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// blog-flavored body: blank line = paragraph · "## " headings (H2–H5) · "> " quote
// placement: "[[2]]" drops image #2 inline · "[[2<]]"/"[[2>]]" float it with text wrap
// pull quotes: ">> text" floats right, "<< text" floats left (add "## " inside for Frankie)
function renderBody(body, images = [], renderImage) {
  const used = new Set();
  const nodes = (body || "")
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((para, i) => {
      const im = para.trim().match(/^\[\[(\d+)(<|>)?\]\]$/);
      if (im) {
        const idx = parseInt(im[1], 10) - 1;
        const meta = images[idx];
        if (!meta || !renderImage) return null;
        used.add(idx);
        const float = im[2] === "<" ? "left" : im[2] === ">" ? "right" : "inline";
        return (
          <div key={i} className={float === "inline" ? "dl-imginline" : `dl-float dl-float-${float}`}>
            {renderImage(meta)}
          </div>
        );
      }
      if (para.startsWith(">> ") || para.startsWith("<< ")) {
        const side = para.startsWith(">>") ? "right" : "left";
        let inner = para.slice(3).replace(/^(>>|<<) ?/gm, "");
        const big = inner.startsWith("## ");
        if (big) inner = inner.slice(3);
        return (
          <blockquote key={i} className={`dl-quote dl-pull dl-pull-${side} ${big ? "dl-quote-big" : ""}`}>
            <p>{mdInline(inner)}</p>
          </blockquote>
        );
      }
      if (para.startsWith("##### ")) return <h5 className="dl-page-h5" key={i}>{mdInline(para.slice(6))}</h5>;
      if (para.startsWith("#### ")) return <h4 className="dl-page-h4" key={i}>{mdInline(para.slice(5))}</h4>;
      if (para.startsWith("### ")) return <h3 className="dl-page-h3" key={i}>{mdInline(para.slice(4))}</h3>;
      if (para.startsWith("## ")) return <h2 className="dl-page-h2" key={i}>{mdInline(para.slice(3))}</h2>;
      if (para.startsWith("> ")) {
        const inner = para.replace(/^> ?/gm, "");
        if (inner.startsWith("## "))
          return (
            <blockquote className="dl-quote dl-quote-big" key={i}>
              <p>{mdInline(inner.slice(3))}</p>
            </blockquote>
          );
        return (
          <blockquote className="dl-quote" key={i}>
            <p>{mdInline(inner)}</p>
          </blockquote>
        );
      }
      return <p className="dl-page-text" key={i}>{mdInline(para)}</p>;
    });
  return { nodes, used };
}

function videoEmbed(url) {
  const yt = String(url || "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = String(url || "").match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

function LinkCard({ data }) {
  const url = data?.url || "";
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  if (!url) return null;
  return (
    <a className={`dl-linkcard ${data?.img ? "dl-linkcard-withimg" : ""}`} href={url} target="_blank" rel="noopener noreferrer">
      <span className="dl-linkcard-body">
        <span className="dl-linkcard-label">{data?.label || url}</span>
        {host && <span className="dl-linkcard-host">{host} ↗</span>}
      </span>
      {data?.img && (
        <span className="dl-linkcard-img">
          <img src={data.img} alt="" loading="lazy" />
        </span>
      )}
    </a>
  );
}

function VideoBlock({ data }) {
  const src = videoEmbed(data?.url);
  if (!src) return <p className="dl-note-text dl-mutetext">{data?.url || "Add a YouTube or Vimeo URL…"}</p>;
  return (
    <span className="dl-videobox">
      <iframe src={src} title="Embedded video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
    </span>
  );
}

function PostCardBlock({ data, pages, onOpenPage }) {
  const p = pages.find((x) => x.slug === data?.slug);
  if (!p) return null;
  return (
    <button className="dl-postcard" onClick={() => onOpenPage(p.slug)}>
      {p.images[0] && (
        <span className="dl-postcard-cover" style={{ aspectRatio: `${p.images[0].w} / ${p.images[0].h}` }}>
          <img src={p.images[0].url} alt="" loading="lazy" />
        </span>
      )}
      <span className="dl-postcard-title">{p.title}</span>
      {p.subtitle && <span className="dl-postcard-sub">{p.subtitle}</span>}
      <span className="dl-work-card-more">Read more</span>
    </button>
  );
}

function SnippetImg({ data }) {
  return (
    <span className="dl-snipimg" style={{ aspectRatio: `${data.w} / ${data.h}` }}>
      <img src={data.url} alt={data.cap || ""} loading="lazy" />
      {data.cap && <span className="dl-itemcap">{data.cap}</span>}
    </span>
  );
}

function SnippetView({ snippet, pages, onOpenPage }) {
  if (!snippet) return <p className="dl-note-text dl-mutetext">This card was deleted.</p>;
  if (snippet.kind === "image") return <SnippetImg data={snippet.data} />;
  if (snippet.kind === "quote")
    return (
      <blockquote className="dl-quote">
        <p>{mdInline(snippet.data.text)}</p>
        {snippet.data.cite && <cite>— {snippet.data.cite}</cite>}
      </blockquote>
    );
  if (snippet.kind === "link") return <LinkCard data={snippet.data} />;
  if (snippet.kind === "video") return <VideoBlock data={snippet.data} />;
  if (snippet.kind === "post") return <PostCardBlock data={snippet.data} pages={pages} onOpenPage={onOpenPage} />;
  return <p className="dl-note-text">{mdInline(snippet.data.text)}</p>;
}

function BlockBody({ note, pages, snippets, onOpenPage }) {
  const kind = note.kind || "text";
  const data = note.data || {};
  if (kind === "quote")
    return (
      <blockquote className="dl-quote">
        <p>{mdInline(note.text)}</p>
        {data.cite && <cite>— {data.cite}</cite>}
      </blockquote>
    );
  if (kind === "link") return <LinkCard data={data} />;
  if (kind === "video") return <VideoBlock data={data} />;
  if (kind === "post") {
    if (!data.slug) return null;
    return <PostCardBlock data={data} pages={pages} onOpenPage={onOpenPage} />;
  }
  if (kind === "card") {
    if (!data.snippetId) return null;
    return <SnippetView snippet={snippets.find((x) => x.id === data.snippetId)} pages={pages} onOpenPage={onOpenPage} />;
  }
  return <p className="dl-note-text">{mdInline(note.text)}</p>;
}

function MdArea({ value, onChange, rows, placeholder, autoFocus, allowBlocks, className, onCursor }) {
  const ref = useRef(null);
  const [sel, setSel] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const update = () => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    onCursor?.(e);
    if (e > s) setSel({ start: s, end: e });
    else {
      setSel(null);
      setLinkMode(false);
    }
  };
  const wrap = (pre, post) => {
    if (!sel) return;
    const p2 = post === undefined ? pre : post;
    const next = value.slice(0, sel.start) + pre + value.slice(sel.start, sel.end) + p2 + value.slice(sel.end);
    onChange(next);
    const el = ref.current;
    const s = sel.start + pre.length;
    const e = sel.end + pre.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s, e);
    });
  };
  const linePrefix = (pfx) => {
    if (!sel) return;
    const ls = value.lastIndexOf("\n", sel.start - 1) + 1;
    onChange(value.slice(0, ls) + pfx + value.slice(ls));
    setSel(null);
  };
  const cycleHeading = () => {
    if (!sel) return;
    const ls = value.lastIndexOf("\n", sel.start - 1) + 1;
    const rest = value.slice(ls);
    const m = rest.match(/^(#{2,5}) /);
    let out;
    if (!m) out = value.slice(0, ls) + "## " + rest;
    else if (m[1].length >= 5) out = value.slice(0, ls) + rest.slice(m[0].length);
    else out = value.slice(0, ls) + "#" + rest;
    onChange(out);
    setSel(null);
  };
  const applyLink = () => {
    if (!linkUrl.trim() || !sel) return;
    wrap("[", `](${linkUrl.trim()})`);
    setLinkMode(false);
    setLinkUrl("");
  };
  return (
    <span className="dl-mdarea">
      {sel && (
        <span className="dl-mdbar" onMouseDown={(e) => e.preventDefault()}>
          {linkMode ? (
            <input
              autoFocus
              value={linkUrl}
              placeholder="https://…"
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === "Escape") setLinkMode(false);
              }}
            />
          ) : (
            <>
              <button aria-label="Bold" onMouseDown={(e) => { e.preventDefault(); wrap("**"); }}><b>B</b></button>
              <button aria-label="Italic" onMouseDown={(e) => { e.preventDefault(); wrap("*"); }}><i>I</i></button>
              {allowBlocks && <button aria-label="Heading — click again for smaller" title="Heading (H2→H5)" onMouseDown={(e) => { e.preventDefault(); cycleHeading(); }}>H</button>}
              {allowBlocks && <button aria-label="Quote" onMouseDown={(e) => { e.preventDefault(); linePrefix("> "); }}>&ldquo;&rdquo;</button>}
              <button aria-label="Link" onMouseDown={(e) => { e.preventDefault(); setLinkMode(true); }}>⌁</button>
            </>
          )}
        </span>
      )}
      <textarea
        ref={ref}
        className={className}
        rows={rows}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onSelect={update}
        onKeyUp={update}
        onClick={update}
        onBlur={() => setTimeout(() => { setSel(null); setLinkMode(false); }, 200)}
      />
    </span>
  );
}

function BlockEditor({ note, pages, snippets, onUploadImg, onSave, onClose }) {
  const kind = note.kind || "text";
  const [text, setText] = useState(note.text || "");
  const [cite, setCite] = useState(note.data?.cite || "");
  const [url, setUrl] = useState(note.data?.url || "");
  const [label, setLabel] = useState(note.data?.label || "");
  const [img, setImg] = useState(note.data?.img || "");
  const [uploading, setUploading] = useState(false);
  const imgFileRef = useRef(null);
  const uploadImgFile = async (file) => {
    if (!file || !onUploadImg) return;
    setUploading(true);
    try {
      const url = await onUploadImg(file);
      if (url) setImg(url);
    } catch {}
    setUploading(false);
  };
  const [slug, setSlug] = useState(note.data?.slug || "");
  const [snippetId, setSnippetId] = useState(note.data?.snippetId || "");
  const save = () => {
    if (kind === "quote") onSave(note.id, { text, data: { cite: cite.trim() } });
    else if (kind === "link") onSave(note.id, { text: "", data: { url: url.trim(), label: label.trim(), img: img.trim() } });
    else if (kind === "video") onSave(note.id, { text: "", data: { url: url.trim() } });
    else if (kind === "post") onSave(note.id, { text: "", data: { slug } });
    else if (kind === "card") onSave(note.id, { text: "", data: { snippetId } });
    else onSave(note.id, { text, data: null });
    onClose();
  };
  return (
    <div className="dl-blockedit" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {(kind === "text" || kind === "quote") && (
        <MdArea autoFocus rows={3} value={text} placeholder={kind === "quote" ? "Quote — highlight text for formatting" : "Write — highlight text for formatting"} onChange={setText} />
      )}
      {kind === "quote" && <input value={cite} placeholder="Attribution (optional)" onChange={(e) => setCite(e.target.value)} />}
      {(kind === "link" || kind === "video") && (
        <input autoFocus={kind === "video"} value={url} placeholder={kind === "video" ? "YouTube or Vimeo URL" : "https://…"} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      )}
      {kind === "link" && <input autoFocus value={label} placeholder="Label" onChange={(e) => setLabel(e.target.value)} />}
      {kind === "link" && (
        <div className="dl-imgrow">
          {img ? (
            <span className="dl-imgrow-thumb">
              <img src={img} alt="" />
              <button className="dl-act" aria-label="Remove share image" onClick={() => setImg("")}>×</button>
            </span>
          ) : (
            <input value={img} placeholder="Share image URL (optional)" onChange={(e) => setImg(e.target.value)} />
          )}
          <button className="dl-imgrow-upload" disabled={uploading} onClick={() => imgFileRef.current?.click()}>
            {uploading ? "Uploading…" : img ? "Replace" : "Upload"}
          </button>
          <input
            ref={imgFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) uploadImgFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {kind === "post" && (
        <select autoFocus value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="" disabled>Pick a post…</option>
          {pages.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
        </select>
      )}
      {kind === "card" && (
        <select autoFocus value={snippetId} onChange={(e) => setSnippetId(e.target.value)}>
          <option value="" disabled>Pick a saved card…</option>
          {snippets.map((sn) => <option key={sn.id} value={sn.id}>{sn.name}</option>)}
        </select>
      )}
      <div className="dl-prodedit-row">
        <button className="dl-prodedit-save" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function CanvasBlock({ note, pos, canEdit, drag, resizing, pages, snippets, onOpenPage, onUploadImg, onDragStart, onResizeStart, onPatchBlock, onSnip, onDelete }) {
  const needsPick =
    (note.kind === "card" && !note.data?.snippetId) ||
    (note.kind === "post" && !note.data?.slug) ||
    (note.kind === "link" && !note.data?.url) ||
    (note.kind === "video" && !note.data?.url);
  const [editingText, setEditingText] = useState(() => canEdit && needsPick);
  const isDragging = (drag && drag.id === note.id) || resizing;
  const style = {
    left: `${pos.fx}%`,
    top: `${pos.top}px`,
    width: `${pos.fw}%`,
    transform: drag && drag.id === note.id ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
    zIndex: isDragging ? 5 : 2,
  };
  const snippable = ["text", "quote", "link", "video"].includes(note.kind || "text");
  return (
    <div
      className={`dl-item dl-item-note ${isDragging ? "dl-item-drag" : ""}`}
      style={style}
      onPointerDown={(e) => canEdit && !editingText && onDragStart(e, note.id, "note")}
    >
      {editingText ? (
        <BlockEditor note={note} pages={pages} snippets={snippets} onUploadImg={onUploadImg} onSave={onPatchBlock} onClose={() => setEditingText(false)} />
      ) : (
        <BlockBody note={note} pages={pages} snippets={snippets} onOpenPage={onOpenPage} />
      )}
      {canEdit && !editingText && (
        <span
          className="dl-resize dl-resize-note"
          title="Drag to scale"
          aria-label="Drag to scale block"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, note.id, "note");
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {canEdit && !editingText && (
        <div className="dl-fig-actions dl-note-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button className="dl-act" title="Edit" aria-label="Edit block" onClick={() => setEditingText(true)}>✎</button>
          {snippable && <button className="dl-act" title="Save as reusable card" aria-label="Save as reusable card" onClick={() => onSnip(note)}>☆</button>}
          <button className="dl-act" title="Remove" aria-label="Remove block" onClick={() => onDelete(note.id)}>×</button>
        </div>
      )}
    </div>
  );
}

// ---------- day canvas ----------
function DayCanvas({ day, isToday, canEdit, filterOn, isMobile, pages, snippets, onOpenPage, onUploadImg, onPick, onPickDay, onAddBlock, onLayout, onOpenDetail, onCycleSize, onDeleteImage, onSnipImage, onPatchBlock, onSnipBlock, onDeleteNote, editing, setEditing, onSaveTags, onSaveProduct, onLinkPage, onCreatePage }) {
  const [wrapRef, width] = useWidth();
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  dragRef.current = drag;
  const justDragged = useRef(false);
  const [addOpen, setAddOpen] = useState(false);

  const flat = filterOn || isMobile;
  const layout = useMemo(() => {
    const base = resolveLayout(day, width < 860 ? 2 : 6);
    const out = new Map();
    for (const [id, p] of base) out.set(id, { ...p, top: (p.fy / 100) * (width || 1) });
    return out;
  }, [day, width]);

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
      const est = ((n.text.length / (p.fw * 0.5)) + 2) * 3;
      max = Math.max(max, p.fy + est);
    }
    return max + 2;
  }, [day, layout]);

  // measure the true rendered bottom of every item — estimates can lie
  // (long captions, tall notes), and the day must always contain its content
  const [contentH, setContentH] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || flat) return;
    const measure = () => {
      let max = 0;
      for (const c of el.children) max = Math.max(max, c.offsetTop + c.offsetHeight);
      setContentH(max);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [layout, day, width, flat]);


  const onDragStart = (e, id, kind) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, kind, mode: "move", startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onResizeStart = (e, id, kind = "img") => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, kind, mode: "resize", startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const liveFw = (p, d) => clamp(snapv(p.fw + (d.dx / (width || 1)) * 100), 10, Math.max(10, 100 - p.fx));
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
      if (d && d.moved) {
        justDragged.current = true;
        setTimeout(() => {
          justDragged.current = false;
        }, 300);
      }
      if (d && d.moved && width > 0) {
        const p = layout.get(d.id);
        if (p && d.mode === "resize") {
          onLayout(day.date, d.id, d.kind, { fx: p.fx, fy: p.fy, fw: liveFw(p, d) }, layout);
        } else if (p) {
          const fx = clamp(snapv(p.fx + (d.dx / width) * 100), 0, 100 - p.fw);
          const fy = Math.max(0, snapv(p.fy + (d.dy / width) * 100));
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
          <span className="dl-dayadd">
            <button className={`dl-plus ${addOpen ? "dl-plus-on" : ""}`} aria-label="Add to this day" aria-expanded={addOpen} onClick={() => setAddOpen((o) => !o)}>+</button>
            {addOpen && (
              <span className="dl-plusmenu">
                <button onClick={() => { setAddOpen(false); onPickDay(day.date); }}>Image</button>
                <button onClick={() => { setAddOpen(false); onAddBlock(day.date, "text"); }}>Text</button>
                <button onClick={() => { setAddOpen(false); onAddBlock(day.date, "quote"); }}>Quote</button>
                <button onClick={() => { setAddOpen(false); onAddBlock(day.date, "link"); }}>Link</button>
                <button onClick={() => { setAddOpen(false); onAddBlock(day.date, "video"); }}>Video</button>
                {pages.length > 0 && <button onClick={() => { setAddOpen(false); onAddBlock(day.date, "post"); }}>Post</button>}
                {snippets.length > 0 && <button onClick={() => { setAddOpen(false); onAddBlock(day.date, "card"); }}>Card</button>}
              </span>
            )}
          </span>
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
                <img src={m.url} alt={m.cap || ""} loading="lazy" draggable={false} />
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
            <div key={n.id} className="dl-note-flat"><BlockBody note={n} pages={pages} snippets={snippets} onOpenPage={onOpenPage} /></div>
          ))}
        </div>
      ) : (
        <div ref={wrapRef} className={`dl-canvas ${canEdit ? "dl-canvas-edit" : ""}`} style={{ height: `${contentH || (heightPct / 100) * (width || 1)}px` }}>
          {day.images.map((m) => {
            const kindOpen = editing && editing.date === day.date && editing.id === m.id;
            return (
              <CanvasImg
                key={m.id}
                meta={m}
                pos={(() => {
                  const p = layout.get(m.id) || { fx: 4, fy: 2, fw: 30, top: 0 };
                  return drag && drag.moved && drag.mode === "resize" && drag.id === m.id ? { ...p, fw: liveFw(p, drag) } : p;
                })()}
                canEdit={canEdit}
                drag={drag && drag.moved && drag.mode === "move" ? drag : null}
                resizing={Boolean(drag && drag.moved && drag.mode === "resize" && drag.id === m.id)}
                onDragStart={onDragStart}
                onResizeStart={onResizeStart}
                onOpen={(meta) => {
                  if (dragRef.current?.moved || justDragged.current) return;
                  onOpenDetail(day.date, meta);
                }}
                onCycleSize={(id) => onCycleSize(day.date, id, layout)}
              onSnip={(meta) => onSnipImage(day.date, meta)}
                onEdit={(ed) => setEditing({ ...ed, date: day.date })}
                onDelete={(id) => onDeleteImage(day.date, id)}
                editorOpen={Boolean(kindOpen)}
                editors={editorsFor(m)}
              />
            );
          })}
          {(day.notes || []).map((n) => (
            <CanvasBlock
              key={n.id}
              note={n}
              pos={(() => {
                const p = layout.get(n.id) || { fx: 4, fy: 2, fw: 28, top: 0 };
                return drag && drag.moved && drag.mode === "resize" && drag.id === n.id ? { ...p, fw: liveFw(p, drag) } : p;
              })()}
              canEdit={canEdit}
              drag={drag && drag.moved && drag.mode === "move" ? drag : null}
              resizing={Boolean(drag && drag.moved && drag.mode === "resize" && drag.id === n.id)}
              onResizeStart={onResizeStart}
              pages={pages}
              snippets={snippets}
              onOpenPage={onOpenPage}
              onUploadImg={onUploadImg}
              onDragStart={onDragStart}
              onPatchBlock={(id, patch) => onPatchBlock(day.date, id, patch)}
              onSnip={(note) => onSnipBlock(note)}
              onDelete={(id) => onDeleteNote(day.date, id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- footer ----------
function Footer() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareTitle = typeof document !== "undefined" ? document.title : "Feed";
  const u = encodeURIComponent(shareUrl);
  const t = encodeURIComponent(shareTitle);
  const copyForInstagram = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <footer className="dl-footer" ref={wrapRef}>
      <span className="dl-footer-c">© {new Date().getFullYear()}</span>
      <span className="dl-share-wrap">
        {open && (
          <div className="dl-share-panel">
            <a href={`https://twitter.com/intent/tweet?url=${u}&text=${t}`} target="_blank" rel="noopener noreferrer">X (Twitter)</a>
            <button onClick={copyForInstagram}>{copied ? "Link copied!" : "Instagram"}</button>
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${u}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a href={`https://pinterest.com/pin/create/button/?url=${u}&description=${t}`} target="_blank" rel="noopener noreferrer">Pinterest</a>
          </div>
        )}
        <button className="dl-share-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Share</button>
      </span>
    </footer>
  );
}

// ---------- about page ----------
function AboutPage({ canEdit, pages, aboutPage, onSaveAbout, onOpenPage, onUploadPhoto, onRemovePhoto }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const DEFAULT_BIO =
    "Hello!\n\nI'm Derrick Kempf, an artist and brand identity designer with over two decades of experience shaping brands and translating vision into meaningful design. I bring a balance of discipline and creative freedom to both brand consulting and personal art, and I am dedicated to helping fellow artists find simplicity and joy in the creative process. I love drawing and the subjects I illustrate typically consist of weird, balding men, or Dewds, as I call them. See more of them out at dewd.cool.\n\nLet's make something cool together.\n\n[Email me](mailto:hello@derrickkempf.com) or connect with me on socials.";
  const [editingAbout, setEditingAbout] = useState(false);
  const [draft, setDraft] = useState(aboutPage?.body || DEFAULT_BIO);
  useEffect(() => {
    setDraft(aboutPage?.body || DEFAULT_BIO);
  }, [aboutPage?.body]);
  const body = aboutPage?.body || DEFAULT_BIO;
  const photo = aboutPage?.images?.[0];
  const photoRef = useRef(null);
  return (
    <div className="dl-page">

      <div className="dl-about">
        <h1 className="dl-work-title dl-about-title">About</h1>
        <div className="dl-about-cols">
          <div className="dl-about-img">
            {photo ? (
              <img src={photo.url} alt="" loading="lazy" draggable={false} />
            ) : (
              canEdit && <span className="dl-about-img-ph">+ Add photo</span>
            )}
            {canEdit && (
              <>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.[0]) onUploadPhoto(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <button className="dl-about-img-pick" onClick={() => photoRef.current?.click()}>
                  {photo ? "Replace" : "Upload"}
                </button>
                {photo && <button className="dl-act dl-about-img-x" aria-label="Remove photo" onClick={onRemovePhoto}>×</button>}
              </>
            )}
          </div>
          <div className="dl-about-text">
            {canEdit && editingAbout ? (
              <>
                <MdArea className="dl-page-text-input" value={draft} rows={9} allowBlocks onChange={setDraft} />
                <p className="dl-prodedit-row">
                  <button className="dl-prodedit-save" onClick={() => { onSaveAbout(draft); setEditingAbout(false); }}>Save</button>
                  <button className="dl-back" onClick={() => { setDraft(body); setEditingAbout(false); }}>Cancel</button>
                </p>
              </>
            ) : (
              renderBody(body).nodes
            )}
            {canEdit && (
              <div className="dl-about-owner">
                {!editingAbout && (
                  <p>
                    <button className="dl-back" onClick={() => setEditingAbout(true)}>Edit this page</button>
                  </p>
                )}
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
// ---------- work / pages ----------
function WorkIndex({ pages, onOpen, canEdit, onCreate }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const snippet = (body) => {
    const first = (body || "").split(/\n\s*\n/)[0] || "";
    return first.length > 150 ? first.slice(0, 147).trimEnd() + "…" : first;
  };
  return (
    <div className="dl-page">

      <div className="dl-work">
        <h1 className="dl-work-title">Works</h1>
        {canEdit && (
          <p className="dl-work-new">
            <button className="dl-back" onClick={onCreate}>+ New post</button>
          </p>
        )}
        {pages.length === 0 ? (
          <p className="dl-loading">No project pages yet.</p>
        ) : (
          <div className="dl-work-grid">
            {pages.map((p) => (
              <button key={p.slug} className="dl-work-card" onClick={() => onOpen(p.slug)}>
                <span className="dl-work-cover" style={{ aspectRatio: p.images[0] ? `${p.images[0].w} / ${p.images[0].h}` : "4 / 3" }}>
                  {p.images[0] ? <img src={p.images[0].url} alt="" loading="lazy" draggable={false} /> : <span className="dl-work-cover-ph" />}
                </span>
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

function PostNav({ pages, slug }) {
  const idx = pages.findIndex((p) => p.slug === slug);
  const prev = idx > 0 ? pages[idx - 1] : null;
  const next = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;
  return (
    <nav className="dl-postnav" aria-label="Post navigation">
      <button
        className={`dl-postnav-btn dl-postnav-prev ${!prev ? "dl-postnav-off" : ""}`}
        aria-label={prev ? `Previous: ${prev.title}` : "No earlier posts"}
        disabled={!prev}
        onClick={() => prev && openPageHash(prev.slug)}
      >
        <svg viewBox="0 0 58.1 13.25" aria-hidden="true"><path d="M58.05,4.61c-.1-.16-.24-.25-.43-.25,0,0-.14.04-.29.04s-.33,0-.48-.04c-1.57,0-2.62.04-3.14.04s-1.05,0-1.57-.04c-1.76,0-2.9-.04-3.43-.08-.57.12-1.05.12-1.28.12s-.43,0-.67-.04c-.9,0-1.47.04-1.81.04s-.71,0-1.05-.04c-.29,0-.57-.08-.9-.21-.14,0-.43.12-.57.12-.33,0-.43-.04-.43-.04-.1,0-.19,0-.29.04-.43.08-.81.12-1.19.12-.19,0-.71-.04-1.81-.04-.95,0-1.62.04-2,.04-.33,0-.67,0-1-.04-.52.04-1.05.04-1.52.04-.52,0-1.38-.04-3.05-.04-.76,0-1.29.04-1.43.04-.33,0-.67-.04-1-.12-.33,0-.48.08-.67.08h-.81c-1.09,0-1.86.04-2.24.04s-.76,0-1.14-.04c-1.14,0-1.86.08-2.19.08-.43,0-.86-.04-1.28-.17-1,.12-1.71.12-2.09.12-.33,0-.71,0-1.05-.04-1.09,0-1.86-.04-2.28-.08-.52,0-.9.08-1.24.08h-.62c-.33,0-.76-.04-1.24-.08-.04,0-.1,0-.16.02,0-1.12.01-2.22.02-3.22,0-.29-.01-.65-.14-.89l-.05-.08c-.51-.39-1.27.25-1.81.53-.74.5-1.45.85-2.27,1.19-2.01.93-3.97,2.12-6,3.13-.65.34-1.73.94-1.43,1.96.33.92,1.3,1.21,2.02,1.62,3.06,1.57,6.07,3.55,9.22,4.7.56-.19.43-1.14.46-1.72,0-.92-.02-1.58-.02-2.45.2.04.43.06.65.06h45.26c.14-.04.43-.29.43-.42v-1.2c0-1,.05-1.66.05-1.99,0-.29,0-.62-.05-.91Z"/></svg>
      </button>
      <button className="dl-postnav-btn dl-postnav-grid" aria-label="All works" onClick={openWorkHash}>
        <svg viewBox="0 0 30.25 30.76" aria-hidden="true"><path d="M26.65,7.61c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M15.28,7.61C10.11,7.63,10.02-.05,15.3,0c4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M3.91,7.61C-1.26,7.63-1.35-.05,3.93,0c4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M26.65,30.76c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M15.28,30.76c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M3.91,30.76c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M26.65,19.19c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M15.28,19.19c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/><path d="M3.91,19.19c-5.17.02-5.26-7.67.02-7.61,4.65.32,4.84,7.21.14,7.6h-.16Z"/></svg>
      </button>
      <button
        className={`dl-postnav-btn dl-postnav-next ${!next ? "dl-postnav-off" : ""}`}
        aria-label={next ? `Next: ${next.title}` : "No newer posts"}
        disabled={!next}
        onClick={() => next && openPageHash(next.slug)}
      >
        <svg viewBox="0 0 58.13 13.17" aria-hidden="true"><path d="M57.75,5.74l-.1-.1c-2.08-1.48-4.46-2.43-6.65-3.69-1.36-.58-2.74-1.76-4.17-1.95-.24.07-.35.36-.41.64-.11,1.46-.05,2.23-.05,3.71-.03,0-.14.04-.26.04-.14,0-.33,0-.48-.04-1.57,0-2.62.04-3.14.04s-1.05,0-1.57-.04c-1.76,0-2.9-.04-3.43-.08-.57.12-1.05.12-1.28.12s-.43,0-.67-.04c-.9,0-1.47.04-1.81.04s-.71,0-1.05-.04c-.29,0-3,.04-3.38.04-.19,0-.71-.04-1.81-.04-.95,0-1.62.04-2,.04-.33,0-.67,0-1-.04-.52.04-1.05.04-1.52.04-.52,0-1.38-.04-3.05-.04-.76,0-1.29.04-1.43.04-.33,0-.67-.04-1-.12-.33,0-.48.08-.67.08h-.81c-1.09,0-1.86.04-2.24.04s-.76,0-1.14-.04c-1.14,0-1.86.08-2.19.08-.43,0-3-.04-3.38-.04-.33,0-.71,0-1.05-.04-1.09,0-1.86-.04-2.28-.08-.52,0-.9.08-1.24.08h-.62c-.33,0-1.67,0-1.71.12-.14.08-.19.25-.19.5v3.48c0,.21.05.33.09.46.24.17.67.21,1.05.21h45.21c0,1.15,0,2.29.02,3.3.05.52.3.87.81.73,2.76-1.11,5.33-2.77,8.03-4.12,1.06-.62,3.96-1.38,2.54-3.29Z"/></svg>
      </button>
    </nav>
  );
}

function Slider({ children }) {
  const ref = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
  };
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  const go = (dir) => {
    const el = ref.current;
    if (!el) return;
    const step = Math.min(el.clientWidth * 0.8, 480);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };
  return (
    <div className="dl-slider-wrap">
      <div className="dl-slider" ref={ref}>{children}</div>
      <button className="dl-slider-arrow dl-slider-arrow-prev" aria-label="Previous" disabled={atStart} onClick={() => go(-1)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19.59 22.05"> <g id="Layer_1-2" data-name="Layer 1"> <path d="M19.4,16.36c-.13-1.69-.3-3.39-.24-5.09.11-3.18.52-6.25.41-9.46-.02-.48-.02-1.08-.24-1.48l-.09-.13c-.86-.65-2.11.41-3.01.88-1.23.83-2.42,1.41-3.78,1.98-3.34,1.54-6.61,3.52-9.99,5.21-1.08.57-2.89,1.56-2.39,3.26.56,1.53,2.16,2.01,3.36,2.69,5.1,2.61,10.11,5.91,15.35,7.83.94-.32.72-1.9.76-2.87,0-.94-.07-1.88-.15-2.82Z"/> </g> </svg>
      </button>
      <button className="dl-slider-arrow dl-slider-arrow-next" aria-label="Next" disabled={atEnd} onClick={() => go(1)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19.76 21.93"> <g id="Layer_1-2" data-name="Layer 1"> <path d="M19.12,9.55l-.16-.17c-3.46-2.47-7.42-4.05-11.06-6.14C5.63,2.28,3.32.31.94,0,.55.12.35.59.27,1.06c-.59,3.27-.03,6.58.05,9.87s-.23,6.47-.15,9.73c.08.86.5,1.45,1.34,1.21,4.59-1.86,8.87-4.61,13.37-6.85,1.76-1.04,6.59-2.29,4.22-5.47Z"/> </g> </svg>
      </button>
    </div>
  );
}

const IMG_MODES = ["regular", "wide", "full", "gallery", "slider"];
function groupImages(images) {
  const groups = [];
  for (const m of images) {
    const mode = m.mode || "regular";
    const last = groups[groups.length - 1];
    if ((mode === "gallery" || mode === "slider") && last && last.mode === mode) last.items.push(m);
    else groups.push({ mode, items: [m] });
  }
  return groups;
}

function PageView({ slug, pages, canEdit, onBack, onPatch, onAddImages, onInsertImage, onRemoveImage, onDeletePage }) {
  const page = pages.find((p) => p.slug === slug);
  const [addMode, setAddMode] = useState("regular");
  const setImageMode = (id, mode) =>
    onPatch(slug, {
      images: page.images.map((m) => {
        const { url, _i, ...rest } = m;
        return m.id === id ? { ...rest, mode } : rest;
      }),
    });
  const [edit, setEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const addRef = useRef(null);
  const insertRef = useRef(null);
  const [cursorPos, setCursorPos] = useState((page?.body || "").length);
  const [insertFloat, setInsertFloat] = useState("inline");
  const bodyRendered = renderBody(page?.body, page?.images || [], (meta) => (
    <figure className="dl-fig dl-page-fig" style={{ aspectRatio: `${meta.w} / ${meta.h}` }}>
      <img src={meta.url} alt="" loading="lazy" draggable={false} />
      {edit && (
        <div className="dl-fig-actions" style={{ opacity: 1 }}>
          <button className="dl-act" aria-label="Remove image" onClick={() => onRemoveImage(slug, meta.id)}>×</button>
        </div>
      )}
    </figure>
  ));
  useEffect(() => {
    window.scrollTo(0, 0);
    setEdit(false);
    setConfirmDel(false);
  }, [slug]);

  if (!page) {
    return (
      <div className="dl-page">
        <p className="dl-loading">That page doesn't exist (anymore).</p>
      </div>
    );
  }

  return (
    <div className="dl-page">
      <div className="dl-page-top">
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
            <MdArea className="dl-page-text-input" value={page.body || ""} placeholder={"Write the post — highlight text for the toolbar. Blank line = paragraph · [[2]] places image #2 · [[2>]] floats it right · >> floated pull quote."} rows={10} allowBlocks onChange={(v) => onPatch(slug, { body: v })} onCursor={setCursorPos} />
          </>
        ) : (
          <>
            <h1 className="dl-page-title">{page.title}</h1>
            {page.subtitle && <p className="dl-page-sub">{page.subtitle}</p>}
            {bodyRendered.nodes}
          </>
        )}

        <div className="dl-page-imgs">
          {groupImages(page.images.map((m, i) => ({ ...m, _i: i })).filter((m) => !bodyRendered.used.has(m._i))).map((g, gi) => {
            const figs = g.items.map((m) => {
              const cls = g.mode === "wide" ? "dl-imgw-wide" : g.mode === "full" ? "dl-imgw-full" : "";
              const style =
                g.mode === "regular"
                  ? { aspectRatio: `${m.w} / ${m.h}`, width: `min(100%, calc(76vh * ${(m.w / m.h).toFixed(4)}))` }
                  : { aspectRatio: `${m.w} / ${m.h}` };
              return (
                <figure key={m.id} className={`dl-fig dl-page-fig ${cls}`} style={style}>
                  <img src={m.url} alt="" loading="lazy" draggable={false} />
                  {edit && (
                    <>
                      <select
                        className="dl-modepick"
                        value={m.mode || "regular"}
                        onChange={(e) => setImageMode(m.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {IMG_MODES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                      <div className="dl-fig-actions" style={{ opacity: 1 }}>
                        <button className="dl-act" aria-label="Remove image" onClick={() => onRemoveImage(slug, m.id)}>×</button>
                      </div>
                      <span className="dl-imgnum" title={`Place in text with [[${m._i + 1}]] · [[${m._i + 1}<]] · [[${m._i + 1}>]]`}>{m._i + 1}</span>
                    </>
                  )}
                </figure>
              );
            });
            if (g.mode === "gallery") return <div className="dl-gal" key={gi}>{figs}</div>;
            if (g.mode === "slider") return <Slider key={gi}>{figs}</Slider>;
            return figs;
          })}
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
                if (e.target.files?.length) onAddImages(slug, e.target.files, addMode);
                e.target.value = "";
              }}
            />
            <input
              ref={insertRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) onInsertImage(slug, e.target.files[0], cursorPos, insertFloat);
                e.target.value = "";
              }}
            />
            <div className="dl-addrow">
              <button className="dl-stage dl-page-add" onClick={() => addRef.current?.click()}>+ Add images to this page</button>
              <label className="dl-addrow-mode">
                New images land as
                <select value={addMode} onChange={(e) => setAddMode(e.target.value)}>
                  {IMG_MODES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            </div>
            <div className="dl-insertrow">
              <button className="dl-stage dl-page-add" onClick={() => insertRef.current?.click()}>+ Insert image where I'm writing</button>
              <label className="dl-addrow-mode">
                float
                <select value={insertFloat} onChange={(e) => setInsertFloat(e.target.value)}>
                  <option value="inline">inline</option>
                  <option value="left">left, text wraps</option>
                  <option value="right">right, text wraps</option>
                </select>
              </label>
              <p className="dl-hint">Click in the text above to set where it lands, then insert.</p>
            </div>
          </>
        )}
      </article>
      <PostNav pages={pages} slug={slug} />
      <Footer />
    </div>
  );
}

// ---------- app ----------
export default function App() {
  const [days, setDays] = useState(null);
  const [pages, setPages] = useState([]);
  const visiblePages = pages.filter((p) => p.slug !== "__about__");
  const [snippets, setSnippets] = useState([]);
  const [route, setRoute] = useState(() => parseHash());
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginErr, setLoginErr] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState([]);
  const [mode, setMode] = useState("visitor");
  const canEdit = mode === "owner";
  const [editing, setEditing] = useState(null);
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

  const refresh = useCallback(async () => {
    try {
      const { days: d, pages: p, snippets: sn } = await be.fetchAll();
      d.forEach((x) => {
        if (!x.notes) x.notes = [];
      });
      setDays(d);
      setPages(p);
      setSnippets(sn || []);
    } catch {
      say("Couldn't reach the backend — check your Supabase settings.");
      setDays([]);
    }
  }, [say]);

  // dedicated login fallback: visiting #login opens the login modal directly
  const consumeLoginHash = useCallback(() => {
    if (window.location.hash === "#login") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setLoginErr(null);
      setLoginOpen(true);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const onHash = () => {
      if (consumeLoginHash()) return;
      setRoute(parseHash());
    };
    window.addEventListener("hashchange", onHash);
    consumeLoginHash();
    refresh();
    if (be.isLocalPreview()) {
      try {
        if (localStorage.getItem("dl-session") === "owner") setMode("owner");
      } catch {}
      console.info("Feed: LOCAL PREVIEW mode (browser storage). Set the Supabase env vars for the real archive.");
    } else {
      be.hasSession().then((ok) => ok && setMode("owner"));
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh, consumeLoginHash]);

  const finishLogin = useCallback(
    (msg) => {
      setMode("owner");
      setLoginOpen(false);
      setLoginErr(null);
      say(msg || "Logged in — drag to arrange, tap ⤢ to resize.");
    },
    [say]
  );

  const submitLogin = useCallback(
    async ({ email, pass }) => {
      if (be.isLocalPreview()) {
        if (PASS && pass !== PASS) {
          setLoginErr("Wrong passphrase.");
          return;
        }
        try {
          localStorage.setItem("dl-session", "owner");
        } catch {}
        finishLogin();
        return;
      }
      setLoginBusy(true);
      const { error } = await be.signInOwner(email, pass);
      setLoginBusy(false);
      if (error) {
        setLoginErr("Sign-in failed — check email and password.");
        return;
      }
      finishLogin();
    },
    [finishLogin]
  );

  const switchMode = useCallback(
    async (next) => {
      if (next === "owner") {
        if (!be.isLocalPreview() && (await be.hasSession())) {
          finishLogin("Logged in.");
          return;
        }
        setLoginErr(null);
        setLoginOpen(true);
        return;
      }
      if (be.isLocalPreview()) {
        try {
          localStorage.setItem("dl-session", "visitor");
        } catch {}
      } else {
        await be.signOutOwner();
      }
      setMode("visitor");
      setEditing(null);
      say("Logged out — this is what visitors see.");
    },
    [say, finishLogin]
  );

  const today = todayStr();
  const baseDays = (() => {
    if (!days) return null;
    if (!canEdit) return days.filter((d) => d.images.length > 0 || (d.notes || []).length > 0);
    if (days.length && String(days[0].date) === today) return days;
    return [{ date: today, images: [], notes: [] }, ...days.filter((d) => String(d.date) !== today)];
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
      .map((d) => ({ ...d, notes: [], images: d.images.filter((m) => (m.tags || []).some((t) => filter.includes(t))) }))
      .filter((d) => d.images.length > 0);
  })();

  const matchCount = filterOn && viewDays ? viewDays.reduce((n, d) => n + d.images.length, 0) : 0;
  const toggleTag = (t) => setFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));

  // ---------- mutations (optimistic where cheap) ----------
  const patchLocalImage = (id, patch) =>
    setDays((ds) => ds?.map((d) => ({ ...d, images: d.images.map((m) => (m.id === id ? { ...m, ...patch } : m)) })));
  const patchLocalNote = (id, patch) =>
    setDays((ds) => ds?.map((d) => ({ ...d, notes: (d.notes || []).map((n) => (n.id === id ? { ...n, ...patch } : n)) })));

  const addFiles = useCallback(
    async (fileList, targetDate) => {
      const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        say("Only image files land here.");
        return;
      }
      setBusy(true);
      try {
        const date = targetDate || todayStr();
        let added = 0;
        for (const f of files) {
          try {
            const { blob, w, h } = await compressFile(f);
            await be.addImage({ id: uid(), date, blob, w, h });
            added++;
          } catch {
            say(`Couldn't add ${f.name}`);
          }
        }
        if (added) {
          await refresh();
          say(`Added ${added === 1 ? "" : added + " "}to ${date === todayStr() ? "today" : dayLabel(date)}.`);
        }
      } finally {
        setBusy(false);
      }
    },
    [say, refresh]
  );

  const deleteImage = useCallback(
    async (date, id) => {
      try {
        await be.deleteImage(date, id);
        await refresh();
      } catch {
        say("Couldn't remove that image.");
      }
    },
    [say, refresh]
  );

  const saveTags = useCallback(
    async (date, id, tags) => {
      patchLocalImage(id, { tags });
      try {
        await be.patchImage(id, { tags });
      } catch {
        say("Couldn't save tags.");
      }
    },
    [say]
  );
  const saveProduct = useCallback(
    async (date, id, product) => {
      patchLocalImage(id, { product });
      try {
        await be.patchImage(id, { product });
        say(product ? "Product linked." : "Product unlinked.");
      } catch {
        say("Couldn't save product.");
      }
    },
    [say]
  );
  const saveCaption = useCallback(
    async (date, id, cap) => {
      patchLocalImage(id, { cap });
      try {
        await be.patchImage(id, { cap });
      } catch {
        say("Couldn't save caption.");
      }
    },
    [say]
  );
  const linkPage = useCallback(
    async (date, id, page) => {
      patchLocalImage(id, { page });
      try {
        await be.patchImage(id, { page });
        say(page ? "Page linked." : "Page unlinked.");
      } catch {
        say("Couldn't save the link.");
      }
    },
    [say]
  );

  // layout: materialize all positions in the day, optimistic + persist
  const persistLayout = useCallback(
    async (date, id, kind, pos, layout) => {
      const updates = [];
      setDays((ds) =>
        ds?.map((d) => {
          if (d.date !== date) return d;
          const images = d.images.map((m) => {
            const p = m.id === id && kind === "img" ? pos : layout.get(m.id);
            if (!p) return m;
            updates.push({ kind: "img", id: m.id, fx: p.fx, fy: p.fy, fw: p.fw });
            return { ...m, fx: p.fx, fy: p.fy, fw: p.fw };
          });
          const notes = (d.notes || []).map((n) => {
            const p = n.id === id && kind === "note" ? pos : layout.get(n.id);
            if (!p) return n;
            updates.push({ kind: "note", id: n.id, fx: p.fx, fy: p.fy, fw: p.fw });
            return { ...n, fx: p.fx, fy: p.fy, fw: p.fw };
          });
          return { ...d, images, notes };
        })
      );
      try {
        await be.saveLayout(updates);
      } catch {
        say("Couldn't save the arrangement.");
      }
    },
    [say]
  );

  const cycleSize = useCallback(
    async (date, id, layout) => {
      const updates = [];
      setDays((ds) =>
        ds?.map((d) => {
          if (d.date !== date) return d;
          const images = d.images.map((m) => {
            const p = layout.get(m.id);
            let next = { ...m };
            if (p && m.fx == null) Object.assign(next, { fx: p.fx, fy: p.fy, fw: p.fw });
            if (m.id === id) {
              const cur = next.fw ?? 30;
              const fw = SIZES[(SIZES.findIndex((s) => s >= cur - 1) + 1) % SIZES.length] ?? SIZES[0];
              next.fw = fw;
              next.fx = clamp(next.fx ?? 4, 0, 100 - fw);
            }
            updates.push({ kind: "img", id: next.id, fx: next.fx, fy: next.fy, fw: next.fw });
            return next;
          });
          return { ...d, images };
        })
      );
      try {
        await be.saveLayout(updates.filter((u) => u.fx != null));
      } catch {
        say("Couldn't save the size.");
      }
    },
    [say]
  );

  // blocks (notes with kinds)
  const BLOCK_DEFAULTS = {
    text: { text: "New text — click ✎ to write. **bold**, *italic*, [links](https://…).", data: null },
    quote: { text: "A quote worth keeping.", data: { cite: "" } },
    link: { text: "", data: { url: "", label: "" } },
    video: { text: "", data: { url: "" } },
    post: { text: "", data: { slug: "" } },
    card: { text: "", data: { snippetId: "" } },
  };
  const addBlock = useCallback(
    async (date, kind) => {
      const def = BLOCK_DEFAULTS[kind] || BLOCK_DEFAULTS.text;
      const n = { id: uid(), day: date, kind, text: def.text, data: def.data ? { ...def.data } : null, fx: 4, fy: 2, fw: 30 };
      try {
        await be.addNote(n);
        await refresh();
      } catch {
        say("Couldn't add that block — run migrate-v3.sql if you haven't.");
      }
    },
    [refresh, say]
  );
  const patchBlock = useCallback(
    async (date, id, patch) => {
      patchLocalNote(id, patch);
      try {
        await be.patchNote(id, patch);
      } catch {
        say("Couldn't save the block.");
      }
    },
    [say]
  );
  const deleteNote = useCallback(
    async (date, id) => {
      try {
        await be.deleteNote(id);
        await refresh();
      } catch {
        say("Couldn't remove that block.");
      }
    },
    [refresh, say]
  );

  // reusable cards (snippets)
  const snipFromBlock = useCallback(
    async (note) => {
      const name = (note.text || note.data?.label || note.data?.url || note.kind || "card").slice(0, 28) || "card";
      const sn = { id: uid(), name, kind: note.kind || "text", data: { ...(note.data || {}), text: note.text } };
      try {
        await be.addSnippet(sn);
        setSnippets((x) => [...x, sn]);
        say(`Saved "${name}" — insert it anywhere via + → Card.`);
      } catch {
        say("Couldn't save the card — run migrate-v3.sql if you haven't.");
      }
    },
    [say]
  );
  const snipFromImage = useCallback(
    async (date, meta) => {
      const name = (meta.cap || "Image card").slice(0, 28);
      const sn = { id: uid(), name, kind: "image", data: { url: meta.url, w: meta.w, h: meta.h, cap: meta.cap || "" } };
      try {
        await be.addSnippet(sn);
        setSnippets((x) => [...x, sn]);
        say(`Saved "${name}" — insert it anywhere via + → Card.`);
      } catch {
        say("Couldn't save the card — run migrate-v3.sql if you haven't.");
      }
    },
    [say]
  );

  // standalone posts (Works page)
  const createPost = useCallback(async () => {
    try {
      let n = pages.length + 1;
      let slug = `untitled-post-${n}`;
      while (pages.some((p) => p.slug === slug)) slug = `untitled-post-${++n}`;
      await be.createPage({ slug, title: "Untitled post", subtitle: "", body: "" });
      await refresh();
      openPageHash(slug);
      say("Post created — hit Edit page and give it a title.");
    } catch {
      say("Couldn't create a post.");
    }
  }, [pages, refresh, say]);

  // pages
  const createPageAndLink = useCallback(
    async (date, id, title) => {
      try {
        let slug = slugify(title);
        let n = 2;
        while (pages.some((p) => p.slug === slug)) slug = `${slugify(title)}-${n++}`;
        await be.createPage({ slug, title, subtitle: "", body: "" });
        await be.patchImage(id, { page: slug });
        await refresh();
        openPageHash(slug);
        say("Page created — hit Edit page to fill it in.");
      } catch {
        say("Couldn't create that page.");
      }
    },
    [pages, refresh, say]
  );
  const patchPage = useCallback(async (slug, patch) => {
    setPages((pgs) => pgs.map((p) => (p.slug === slug ? { ...p, ...patch } : p)));
    try {
      await be.patchPage(slug, patch);
    } catch {}
  }, []);
  const ensureAboutPage = useCallback(
    async (defaults = {}) => {
      const exists = pages.some((p) => p.slug === "__about__");
      if (!exists) {
        await be.createPage({ slug: "__about__", title: "About", subtitle: "", body: "", ...defaults });
        await refresh();
      }
    },
    [pages, refresh]
  );
  const saveAbout = useCallback(
    async (body, subtitle) => {
      try {
        await ensureAboutPage({ body, subtitle });
        await patchPage("__about__", { body, subtitle });
        say("About page saved.");
      } catch {
        say("Couldn't save the About page.");
      }
    },
    [ensureAboutPage, patchPage, say]
  );
  const uploadAboutPhoto = useCallback(
    async (file) => {
      if (!file || !file.type.startsWith("image/")) return;
      setBusy(true);
      try {
        await ensureAboutPage();
        const current = pages.find((p) => p.slug === "__about__");
        if (current?.images?.[0]) await removePageImage("__about__", current.images[0].id);
        await addPageImages("__about__", [file], "regular");
        say("Photo updated.");
      } catch {
        say("Couldn't upload that photo.");
      }
      setBusy(false);
    },
    [ensureAboutPage, pages, say]
  );
  const removeAboutPhoto = useCallback(async () => {
    const current = pages.find((p) => p.slug === "__about__");
    if (current?.images?.[0]) await removePageImage("__about__", current.images[0].id);
  }, [pages]);
  const insertImageAt = useCallback(
    async (slug, file, atPos, float) => {
      if (!file || !file.type.startsWith("image/")) return;
      setBusy(true);
      try {
        const page = pages.find((p) => p.slug === slug);
        const idx = (page?.images || []).length;
        const { blob, w, h } = await compressFile(file);
        await be.addPageImage({ slug, id: uid(), blob, w, h, mode: "regular" });
        const body = page?.body || "";
        const pos = Math.max(0, Math.min(atPos ?? body.length, body.length));
        const token = float === "left" ? `[[${idx + 1}<]]` : float === "right" ? `[[${idx + 1}>]]` : `[[${idx + 1}]]`;
        const before = body.slice(0, pos).replace(/\n*$/, "");
        const after = body.slice(pos).replace(/^\n*/, "");
        const newBody = [before, token, after].filter(Boolean).join("\n\n");
        await patchPage(slug, { body: newBody });
        await refresh();
        say("Image placed.");
      } catch {
        say("Couldn't insert that image.");
      }
      setBusy(false);
    },
    [pages, patchPage, refresh, say]
  );
  const addPageImages = useCallback(
    async (slug, fileList, mode = "regular") => {
      const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      setBusy(true);
      try {
        let added = 0;
        for (const f of files) {
          try {
            const { blob, w, h } = await compressFile(f);
            await be.addPageImage({ slug, id: uid(), blob, w, h, mode });
            added++;
          } catch {
            say(`Couldn't add ${f.name}`);
          }
        }
        await refresh();
        if (added) say(`Added ${added} to the page.`);
      } finally {
        setBusy(false);
      }
    },
    [say, refresh]
  );
  const removePageImage = useCallback(
    async (slug, id) => {
      try {
        await be.removePageImage(slug, id);
        await refresh();
      } catch {
        say("Couldn't remove that image.");
      }
    },
    [say, refresh]
  );
  const deletePage = useCallback(
    async (slug) => {
      try {
        await be.deletePage(slug);
        await refresh();
        closePageHash();
        say("Page deleted.");
      } catch {
        say("Couldn't delete that page.");
      }
    },
    [say, refresh]
  );

  const buy = useCallback(async (meta) => {
    const url = await checkoutUrl(meta.product || {});
    if (url) window.open(url, "_blank", "noopener");
  }, []);

  // file drag & drop (owner, feed only)
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

  // keyboard
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
        switchMode(canEdit ? "visitor" : "owner");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [switchMode, canEdit, detail]);

  // link-card share images: small upload to the asset bucket
  const uploadLinkImg = useCallback(async (file) => {
    const { blob } = await compressFile(file, 720);
    return await be.uploadAsset({ id: uid(), blob });
  }, []);

  const dayTarget = useRef(null);
  const pick = () => {
    dayTarget.current = null;
    fileRef.current?.click();
  };
  const pickForDay = (date) => {
    dayTarget.current = date;
    fileRef.current?.click();
  };

  // Ghost-style: pasting an image from the clipboard posts it to today
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e) => {
      if (routeRef.current) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canEdit, addFiles]);

  // mobile login: 5 quick taps on the wordmark
  const tapRef = useRef({ n: 0, t: 0 });
  const markTap = () => {
    const now = Date.now();
    if (now - tapRef.current.t > 2500) tapRef.current.n = 0;
    tapRef.current.t = now;
    tapRef.current.n += 1;
    if (tapRef.current.n >= 5) {
      tapRef.current.n = 0;
      switchMode(canEdit ? "visitor" : "owner");
    }
  };

  const siteHeader = (
    <header className="dl-top">
      <div className="dl-toprow">
        <button className="dl-mark" onClick={() => { markTap(); if (route) closePageHash(); }}>{SITE_NAME}</button>
        <span className="dl-tagline">{SITE_TAGLINE}</span>
        <nav className="dl-topright">
          {canEdit && !route && <button className="dl-add" onClick={pick}>+ Add</button>}
          <button className="dl-navlink" onClick={openWorkHash}>Works</button>
          <button className="dl-navlink" onClick={openAboutHash}>About</button>
        </nav>
      </div>
    </header>
  );

  const detailMeta = detail && days ? days.find((d) => d.date === detail.date)?.images.find((m) => m.id === detail.id) : null;

  if (route) {
    return (
      <div className="dl-root">
        {siteHeader}
        {route.kind === "work" ? (
          <WorkIndex key="work" pages={visiblePages} onOpen={openPageHash} canEdit={canEdit} onCreate={createPost} />
        ) : route.kind === "about" ? (
          <AboutPage
            key="about"
            canEdit={canEdit}
            pages={visiblePages}
            aboutPage={pages.find((p) => p.slug === "__about__")}
            onSaveAbout={saveAbout}
            onUploadPhoto={uploadAboutPhoto}
            onRemovePhoto={removeAboutPhoto}
            onOpenPage={openPageHash}
          />
        ) : (
          <PageView
            key={`p-${route.slug}`}
            slug={route.slug}
            pages={visiblePages}
            canEdit={canEdit}
            onBack={closePageHash}
            onPatch={patchPage}
            onAddImages={addPageImages}
            onInsertImage={insertImageAt}
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
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files, dayTarget.current || undefined); dayTarget.current = null; e.target.value = ""; }} />

      {siteHeader}

      <h1 className="dl-hero">
        {SITE_HERO.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {line}
          </span>
        ))}
      </h1>

      <main className="dl-scroll">
        {be.isLocalPreview() && canEdit && (
          <p className="dl-filternote">Local preview mode — images live in this browser only. Set the Supabase env vars for the permanent archive.</p>
        )}
        {filterOn && viewDays && (
          <p className="dl-filternote">
            {matchCount === 0 ? "No images match this filter." : `${matchCount} image${matchCount === 1 ? "" : "s"} tagged ${filter.join(", ")}`}{" "}
            <button className="dl-clear" onClick={() => setFilter([])}>Clear</button>
          </p>
        )}
        {viewDays === null ? (
          <p className="dl-loading">Loading the days…</p>
        ) : viewDays.length === 0 ? (
          <p className="dl-loading">Nothing here yet.</p>
        ) : (
          viewDays.map((d) => (
            <DayCanvas
              key={d.date}
              day={d}
              isToday={String(d.date) === today}
              canEdit={canEdit}
              filterOn={filterOn}
              isMobile={isMobile}
              pages={pages}
              onPick={pick}
              onPickDay={pickForDay}
              onAddBlock={addBlock}
              onLayout={persistLayout}
              onOpenDetail={(date, m) => setDetail({ date, id: m.id })}
              onCycleSize={cycleSize}
              onDeleteImage={deleteImage}
              onSnipImage={snipFromImage}
              onPatchBlock={patchBlock}
              onSnipBlock={snipFromBlock}
              onDeleteNote={deleteNote}
              snippets={snippets}
              onOpenPage={openPageHash}
              onUploadImg={uploadLinkImg}
              editing={editing}
              setEditing={setEditing}
              onSaveTags={saveTags}
              onSaveProduct={saveProduct}
              onLinkPage={linkPage}
              onCreatePage={createPageAndLink}
            />
          ))
        )}
        {viewDays && viewDays.length > 0 && !filterOn && (
          <>
            <p className="dl-end">— beginning of the scroll —</p>
            <img className="dl-endmark" src="/feed-footer.svg" alt="Feed" loading="lazy" />
          </>
        )}
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
          onShopBuy={buy}
          onOpenPage={openPageHash}
          onTagClick={toggleTag}
        />
      )}

      {loginOpen && (
        <LoginModal localMode={be.isLocalPreview()} onClose={() => setLoginOpen(false)} onSubmit={submitLogin} error={loginErr} busy={loginBusy} />
      )}

      <Footer />
    </div>
  );
}
