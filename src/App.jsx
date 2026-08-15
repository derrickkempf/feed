import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as be from "./backend.js";
import { fourthwallEnabled, getAllProducts, checkoutUrl } from "./fourthwall.js";

/*
  DAYLOG v2 — deployed version.
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
const SITE_HERO = ["A daily record of", "what I'm making"];
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
  (day.notes || []).forEach((n, i) => {
    out.set(n.id, { fx: n.fx ?? 4, fy: n.fy ?? 2 + i * 6, fw: n.fw ?? 28 });
  });
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
function CanvasImg({ meta, pos, canEdit, drag, onDragStart, onOpen, onCycleSize, onEdit, onDelete, editorOpen, editors }) {
  const isDragging = drag && drag.id === meta.id;
  const style = {
    left: `${pos.fx}%`,
    top: `${pos.top}px`,
    width: `${pos.fw}%`,
    transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
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

// ---------- day canvas ----------
function DayCanvas({ day, isToday, canEdit, filterOn, isMobile, pages, onPick, onAddNote, onLayout, onOpenDetail, onCycleSize, onDeleteImage, onEditNoteText, onDeleteNote, editing, setEditing, onSaveTags, onSaveProduct, onLinkPage, onCreatePage }) {
  const [wrapRef, width] = useWidth();
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  dragRef.current = drag;

  const flat = filterOn || isMobile;
  const layout = useMemo(() => {
    const base = resolveLayout(day, width < 860 ? 2 : 3);
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
        {canEdit && !filterOn && <button className="dl-addnote" onClick={() => onAddNote(day.date)}>+ note</button>}
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
            <div key={n.id} className="dl-note-flat"><p className="dl-note-text">{n.text}</p></div>
          ))}
        </div>
      ) : (
        <div ref={wrapRef} className={`dl-canvas ${canEdit ? "dl-canvas-edit" : ""}`} style={{ height: `${(heightPct / 100) * (width || 1)}px` }}>
          {day.images.map((m) => {
            const kindOpen = editing && editing.date === day.date && editing.id === m.id;
            return (
              <CanvasImg
                key={m.id}
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
                editorOpen={Boolean(kindOpen)}
                editors={editorsFor(m)}
              />
            );
          })}
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
function AboutPage({ canEdit, pages, onOpenPage }) {
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

// ---------- breadcrumbs / work / pages ----------
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
            <figure key={m.id} className="dl-fig dl-page-fig" style={{ aspectRatio: `${m.w} / ${m.h}` }}>
              <img src={m.url} alt="" loading="lazy" draggable={false} />
              {edit && (
                <div className="dl-fig-actions" style={{ opacity: 1 }}>
                  <button className="dl-act" aria-label="Remove image" onClick={() => onRemoveImage(slug, m.id)}>×</button>
                </div>
              )}
            </figure>
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

// ---------- app ----------
export default function App() {
  const [days, setDays] = useState(null);
  const [pages, setPages] = useState([]);
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
      const { days: d, pages: p } = await be.fetchAll();
      d.forEach((x) => {
        if (!x.notes) x.notes = [];
      });
      setDays(d);
      setPages(p);
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
      console.info("Daylog: LOCAL PREVIEW mode (browser storage). Set the Supabase env vars for the real archive.");
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
    async (fileList) => {
      const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        say("Only image files land here.");
        return;
      }
      setBusy(true);
      try {
        const date = todayStr();
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
          say(added === 1 ? "Added to today." : `Added ${added} to today.`);
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

  // notes
  const addNote = useCallback(
    async (date) => {
      const n = { id: uid(), day: date, text: "New note — click ✎ to edit, drag to place.", fx: 4, fy: 2, fw: 28 };
      try {
        await be.addNote(n);
        await refresh();
      } catch {
        say("Couldn't add a note.");
      }
    },
    [refresh, say]
  );
  const editNoteText = useCallback(
    async (date, id, text) => {
      patchLocalNote(id, { text: text || "…" });
      try {
        await be.patchNote(id, { text: text || "…" });
      } catch {
        say("Couldn't save the note.");
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
        say("Couldn't remove that note.");
      }
    },
    [refresh, say]
  );

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
  const addPageImages = useCallback(
    async (slug, fileList) => {
      const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      setBusy(true);
      try {
        let added = 0;
        for (const f of files) {
          try {
            const { blob, w, h } = await compressFile(f);
            await be.addPageImage({ slug, id: uid(), blob, w, h });
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
      switchMode(canEdit ? "visitor" : "owner");
    }
  };

  const detailMeta = detail && days ? days.find((d) => d.date === detail.date)?.images.find((m) => m.id === detail.id) : null;

  if (route) {
    return (
      <div className="dl-root">
        {route.kind === "work" ? (
          <WorkIndex pages={pages} onOpen={openPageHash} />
        ) : route.kind === "about" ? (
          <AboutPage canEdit={canEdit} pages={pages} onOpenPage={openPageHash} />
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
