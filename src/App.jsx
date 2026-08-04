import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as be from "./backend.js";
import { fourthwallEnabled, getAllProducts, checkoutUrl } from "./fourthwall.js";

/*
  DAYLOG — deployed version.
  · One canvas per day; days become a continuous scroll.
  · # tags + filter · $ Fourthwall products · ↗ deeper-dive pages (#/p/<slug>)
  · Work index at #/work · breadcrumbs on every routed view.
  · Cmd/Ctrl+Shift+L (+ passphrase) toggles owner mode.
  Storage: Supabase when configured, browser-local preview otherwise (backend.js).
*/

const MAX_DIM = 1600;
const TARGET_BYTES = 1_800_000;
const PASS = import.meta.env.VITE_OWNER_PASSPHRASE || "";

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

// ---------- routing (#/work · #/p/<slug>) ----------
const parseHash = () => {
  const h = window.location.hash;
  if (h === "#/work") return { kind: "work" };
  const m = h.match(/^#\/p\/(.+)$/);
  return m ? { kind: "page", slug: decodeURIComponent(m[1]) } : null;
};
const openPageHash = (slug) => (window.location.hash = `#/p/${encodeURIComponent(slug)}`);
const openWorkHash = () => (window.location.hash = "#/work");
const closePageHash = () => (window.location.hash = "");

// ---------- image compression → JPEG blob ----------
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
      reject(new Error("Couldn't read image"));
    };
    img.src = url;
  });
}

// ---------- image with placeholder (native lazy; src is a real URL) ----------
function Pic({ meta, className, children }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <figure className={className} style={{ aspectRatio: `${meta.w} / ${meta.h}` }}>
      {!loaded && <div className="dl-ph" />}
      <img
        src={meta.url}
        alt={(meta.tags || []).join(", ")}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        style={loaded ? undefined : { opacity: 0 }}
      />
      {children}
    </figure>
  );
}

// ---------- editors ----------
function TagEditor({ date, meta, onSave, onClose }) {
  const [tags, setTags] = useState(meta.tags || []);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const commit = (list) => {
    setTags(list);
    onSave(date, meta.id, list);
  };
  const addDraft = () => {
    const t = normTag(draft);
    if (t && !tags.includes(t)) commit([...tags, t]);
    setDraft("");
  };
  return (
    <div className="dl-tagedit" onClick={(e) => e.stopPropagation()}>
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

function ProductEditor({ date, meta, onSave, onClose }) {
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
    onSave(date, meta.id, {
      slug: prod.slug,
      variantId: prod.variantId,
      name: prod.name,
      price: prod.price,
      url: prod.url,
    });
    onClose();
  };

  const save = () => {
    const clean = { name: name.trim(), price: price.trim(), url: url.trim() };
    onSave(date, meta.id, clean.name || clean.url ? clean : null);
    onClose();
  };

  return (
    <div className="dl-prodedit" onClick={(e) => e.stopPropagation()}>
      {fourthwallEnabled() && (
        <select className="dl-pagepick" defaultValue="" onChange={(e) => pickCatalog(e.target.value)}>
          <option value="" disabled>
            {catalog === null ? "Loading your Fourthwall products…" : "Pick a Fourthwall product…"}
          </option>
          {(catalog || []).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name} {c.price ? `— ${c.price}` : ""}
            </option>
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
        {meta.product && (
          <button className="dl-prodedit-remove" onClick={() => { onSave(date, meta.id, null); onClose(); }}>Unlink</button>
        )}
        <button className="dl-prodedit-save" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function PageLinkEditor({ date, meta, pages, onLink, onCreateAndLink, onClose }) {
  const [title, setTitle] = useState("");
  return (
    <div className="dl-prodedit" onClick={(e) => e.stopPropagation()}>
      {pages.length > 0 && (
        <select
          className="dl-pagepick"
          defaultValue={meta.page || ""}
          onChange={(e) => {
            if (e.target.value) {
              onLink(date, meta.id, e.target.value);
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
            onCreateAndLink(date, meta.id, title.trim());
            onClose();
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="dl-prodedit-row">
        {meta.page && (
          <button className="dl-prodedit-remove" onClick={() => { onLink(date, meta.id, null); onClose(); }}>Unlink</button>
        )}
        <button
          className="dl-prodedit-save"
          onClick={() => {
            if (title.trim()) onCreateAndLink(date, meta.id, title.trim());
            onClose();
          }}
        >
          {title.trim() ? "Create + link" : "Done"}
        </button>
      </div>
    </div>
  );
}

// ---------- scroll image ----------
function ScrollImg({ date, meta, canEdit, pages, onDelete, editing, onEditToggle, onSaveTags, onSaveProduct, onLinkPage, onCreatePage, onTagClick, onShop, onOpenPage }) {
  const tags = meta.tags || [];
  const kindOpen = (k) => editing && editing.kind === k && editing.date === date && editing.id === meta.id;
  const isTags = kindOpen("tags");
  const isProduct = kindOpen("product");
  const isPage = kindOpen("page");
  const editorOpen = isTags || isProduct || isPage;
  const linkedPage = meta.page && pages.find((p) => p.slug === meta.page);

  return (
    <Pic meta={meta} className={`dl-fig ${editorOpen ? "dl-fig-editing" : ""}`}>
      {canEdit && (
        <div className="dl-fig-actions">
          <button
            className={`dl-act ${meta.page ? "dl-act-on" : ""}`}
            aria-label="Link a page"
            title={meta.page ? "Edit page link" : "Link a deeper-dive page"}
            onClick={() => onEditToggle(isPage ? null : { date, id: meta.id, kind: "page" })}
          >↗</button>
          <button
            className={`dl-act ${meta.product ? "dl-act-on" : ""}`}
            aria-label="Link product"
            title={meta.product ? "Edit linked product" : "Link a product"}
            onClick={() => onEditToggle(isProduct ? null : { date, id: meta.id, kind: "product" })}
          >$</button>
          <button
            className="dl-act"
            aria-label="Edit tags"
            title="Edit tags"
            onClick={() => onEditToggle(isTags ? null : { date, id: meta.id, kind: "tags" })}
          >#</button>
          <button className="dl-act" aria-label="Remove image" title="Remove" onClick={() => onDelete(date, meta.id)}>×</button>
        </div>
      )}

      {!editorOpen && (linkedPage || meta.product) && (
        <div className="dl-chiprow">
          {linkedPage && (
            <button className="dl-shopchip" onClick={() => onOpenPage(linkedPage.slug)}>
              {linkedPage.title} ↗
            </button>
          )}
          {meta.product && (
            <button className="dl-shopchip" onClick={() => onShop(meta)}>
              Shop{meta.product.price ? ` · ${meta.product.price}` : ""}
            </button>
          )}
        </div>
      )}

      {!editorOpen && tags.length > 0 && (
        <div className="dl-fig-tags">
          {tags.map((t) => (
            <button key={t} className="dl-minitag" onClick={() => onTagClick(t)}>{t}</button>
          ))}
        </div>
      )}

      {canEdit && isTags && <TagEditor date={date} meta={meta} onSave={onSaveTags} onClose={() => onEditToggle(null)} />}
      {canEdit && isProduct && <ProductEditor date={date} meta={meta} onSave={onSaveProduct} onClose={() => onEditToggle(null)} />}
      {canEdit && isPage && (
        <PageLinkEditor date={date} meta={meta} pages={pages} onLink={onLinkPage} onCreateAndLink={onCreatePage} onClose={() => onEditToggle(null)} />
      )}
    </Pic>
  );
}

// ---------- one day ----------
function DaySection({ day, isToday, canEdit, filterOn, onPick, ...img }) {
  const empty = day.images.length === 0;
  return (
    <section className="dl-day">
      <header className="dl-dayhead">
        <span className="dl-daylabel">{dayLabel(day.date)}</span>
        <span className="dl-count">{day.images.length > 0 ? `${day.images.length}` : ""}</span>
      </header>
      {empty && isToday && canEdit && !filterOn ? (
        <button className="dl-stage" onClick={onPick}>
          <span className="dl-stage-title">Today</span>
          <span>Drag images anywhere on this page</span>
          <span className="dl-stage-sub">or tap here to choose files</span>
        </button>
      ) : (
        <div className="dl-grid">
          {day.images.map((m) => (
            <ScrollImg key={m.id} date={day.date} meta={m} canEdit={canEdit} {...img} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- breadcrumb ----------
function Crumbs({ trail }) {
  return (
    <nav className="dl-crumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <span key={i} className="dl-crumb-wrap">
          {i > 0 && <span className="dl-crumb-sep">/</span>}
          {c.onGo ? (
            <button className="dl-crumb" onClick={c.onGo}>{c.label}</button>
          ) : (
            <span className="dl-crumb dl-crumb-here">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ---------- work index ----------
function WorkIndex({ pages, onOpen }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const snippet = (body) => {
    const first = (body || "").split(/\n\s*\n/)[0] || "";
    return first.length > 160 ? first.slice(0, 157).trimEnd() + "…" : first;
  };
  return (
    <div className="dl-page">
      <div className="dl-page-top">
        <Crumbs trail={[{ label: "Feed", onGo: closePageHash }, { label: "Work" }]} />
      </div>
      <div className="dl-work">
        <h1 className="dl-work-title">Work</h1>
        {pages.length === 0 ? (
          <p className="dl-loading">No project pages yet.</p>
        ) : (
          <ul className="dl-work-list">
            {pages.map((p) => (
              <li key={p.slug}>
                <button className="dl-work-item" onClick={() => onOpen(p.slug)}>
                  <span className="dl-work-item-title">{p.title}</span>
                  {p.subtitle && <span className="dl-work-item-sub">{p.subtitle}</span>}
                  {p.body && <span className="dl-work-item-snip">{snippet(p.body)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- deeper-dive page ----------
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
        <Crumbs
          trail={[
            { label: "Feed", onGo: onBack },
            { label: "Work", onGo: openWorkHash },
            { label: page.title },
          ]}
        />
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
            <input
              className="dl-page-title-input"
              value={page.title}
              placeholder="Page title"
              onChange={(e) => onPatch(slug, { title: e.target.value })}
            />
            <input
              className="dl-page-sub-input"
              value={page.subtitle || ""}
              placeholder="Year — medium, edition… (subtitle)"
              onChange={(e) => onPatch(slug, { subtitle: e.target.value })}
            />
            <textarea
              className="dl-page-text-input"
              value={page.body || ""}
              placeholder="The deeper dive. Blank line = new paragraph."
              rows={7}
              onChange={(e) => onPatch(slug, { body: e.target.value })}
            />
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
            <Pic key={m.id} meta={m} className="dl-fig dl-page-fig">
              {edit && (
                <div className="dl-fig-actions" style={{ opacity: 1 }}>
                  <button className="dl-act" aria-label="Remove image" title="Remove" onClick={() => onRemoveImage(slug, m.id)}>×</button>
                </div>
              )}
            </Pic>
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
            <button className="dl-stage dl-page-add" onClick={() => addRef.current?.click()}>
              + Add images to this page
            </button>
          </>
        )}
      </article>
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
  const [modal, setModal] = useState(false);
  const [shopItem, setShopItem] = useState(null);
  const [filter, setFilter] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [mode, setMode] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("dl-session") === "owner" ? "owner" : "visitor"
  );
  const canEdit = mode === "owner";
  const [editing, setEditing] = useState(null);
  const dragDepth = useRef(0);
  const fileRef = useRef(null);
  const toastTimer = useRef(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { days: d, pages: p } = await be.fetchAll();
      setDays(d);
      setPages(p);
    } catch {
      say("Couldn't reach the backend — check your Supabase settings.");
      setDays([]);
    }
  }, [say]);

  // boot
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    refresh();
    if (be.isLocalPreview()) {
      console.info("Daylog: running in LOCAL PREVIEW mode (browser storage). Set the Supabase env vars for the real archive.");
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  const switchMode = useCallback(
    (next) => {
      if (next === "owner" && PASS) {
        const entered = window.prompt("Passphrase:");
        if (entered !== PASS) {
          say("Wrong passphrase.");
          return;
        }
      }
      setMode(next);
      setEditing(null);
      try {
        localStorage.setItem("dl-session", next);
      } catch {}
      say(next === "visitor" ? "Logged out — this is what visitors see." : "Logged in — you can add, tag, link, and remove.");
    },
    [say]
  );

  const today = todayStr();
  const baseDays = (() => {
    if (!days) return null;
    if (!canEdit) return days.filter((d) => d.images.length > 0);
    if (days.length && String(days[0].date) === today) return days;
    return [{ date: today, images: [] }, ...days.filter((d) => String(d.date) !== today)];
  })();

  const allTags = useMemo(() => {
    const map = new Map();
    (days || []).forEach((d) =>
      d.images.forEach((m) => (m.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1)))
    );
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
        images: d.images.filter((m) => (m.tags || []).some((t) => filter.includes(t))),
      }))
      .filter((d) => d.images.length > 0);
  })();

  const matchCount = filterOn && viewDays ? viewDays.reduce((n, d) => n + d.images.length, 0) : 0;
  const toggleTag = (t) => setFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));

  // ---------- mutations ----------
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

  const patchLocal = (id, patch) =>
    setDays((ds) =>
      ds?.map((d) => ({ ...d, images: d.images.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
    );

  const saveTags = useCallback(
    async (date, id, tags) => {
      patchLocal(id, { tags });
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
      patchLocal(id, { product });
      try {
        await be.patchImage(id, { product });
        say(product ? "Product linked." : "Product unlinked.");
      } catch {
        say("Couldn't save product.");
      }
    },
    [say]
  );

  const linkPage = useCallback(
    async (date, id, page) => {
      patchLocal(id, { page });
      try {
        await be.patchImage(id, { page });
        say(page ? "Page linked." : "Page unlinked.");
      } catch {
        say("Couldn't save the link.");
      }
    },
    [say]
  );

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
        say("Page created — you're on it. Hit Edit page to fill it in.");
      } catch {
        say("Couldn't create that page.");
      }
    },
    [pages, refresh, say]
  );

  const patchPage = useCallback(
    async (slug, patch) => {
      setPages((pgs) => pgs.map((p) => (p.slug === slug ? { ...p, ...patch } : p)));
      try {
        await be.patchPage(slug, patch);
      } catch {}
    },
    []
  );

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

  // ---------- global drag & drop (owner only, feed view only) ----------
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

  // esc closes overlays · ⌘/Ctrl+Shift+L toggles login
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") {
        if (routeRef.current) closePageHash();
        setModal(false);
        setEditing(null);
        setShopItem(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        switchMode(canEdit ? "visitor" : "owner");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [canEdit, switchMode]);

  const pick = () => fileRef.current?.click();

  // ---------- routed views ----------
  if (route) {
    return (
      <div className="dl-root">
        {route.kind === "work" ? (
          <WorkIndex pages={pages} onOpen={openPageHash} />
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <header className="dl-top">
        <div className="dl-toprow">
          <span className="dl-mark">DAYLOG</span>
          <div className="dl-topright">
            {allTags.length > 0 && (
              <button
                className={`dl-filtericon ${filterOpen || filterOn ? "dl-filtericon-on" : ""}`}
                aria-label={filterOpen ? "Hide tag filters" : "Show tag filters"}
                aria-expanded={filterOpen}
                title="Filter by tag"
                onClick={() => setFilterOpen((o) => !o)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
                </svg>
                {filterOn && <span className="dl-filterbadge">{filter.length}</span>}
              </button>
            )}
            {canEdit && <button className="dl-add" onClick={pick}>+ Add to today</button>}
            {pages.length > 0 && <button className="dl-about" onClick={openWorkHash}>Work</button>}
            <button className="dl-about" onClick={() => setModal(true)}>About</button>
          </div>
        </div>

        {filterOpen && allTags.length > 0 && (
          <div className="dl-filterbar" role="group" aria-label="Filter by tag">
            {allTags.map(([t, n]) => (
              <button
                key={t}
                className={`dl-chip ${filter.includes(t) ? "dl-chip-on" : ""}`}
                aria-pressed={filter.includes(t)}
                onClick={() => toggleTag(t)}
              >
                {t} <span className="dl-chip-n">{n}</span>
              </button>
            ))}
            {filterOn && <button className="dl-clear" onClick={() => setFilter([])}>Clear</button>}
          </div>
        )}
      </header>

      <main className="dl-scroll">
        {be.isLocalPreview() && canEdit && (
          <p className="dl-filternote">
            Local preview mode — images live in this browser only. Set the Supabase env vars for the permanent archive.
          </p>
        )}
        {filterOn && viewDays && (
          <p className="dl-filternote">
            {matchCount === 0
              ? "No images match this filter."
              : `${matchCount} image${matchCount === 1 ? "" : "s"} tagged ${filter.join(", ")}`}
          </p>
        )}
        {viewDays === null ? (
          <p className="dl-loading">Loading the days…</p>
        ) : viewDays.length === 0 ? (
          <p className="dl-loading">Nothing here yet.</p>
        ) : (
          viewDays.map((d) => (
            <DaySection
              key={d.date}
              day={d}
              isToday={String(d.date) === today}
              canEdit={canEdit}
              filterOn={filterOn}
              onPick={pick}
              pages={pages}
              onDelete={deleteImage}
              editing={editing}
              onEditToggle={setEditing}
              onSaveTags={saveTags}
              onSaveProduct={saveProduct}
              onLinkPage={linkPage}
              onCreatePage={createPageAndLink}
              onTagClick={toggleTag}
              onShop={setShopItem}
              onOpenPage={openPageHash}
            />
          ))
        )}
        {viewDays && viewDays.length > 0 && !filterOn && (
          <p className="dl-end">— beginning of the scroll —</p>
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

      {shopItem && shopItem.product && (
        <div className="dl-modal-veil" onClick={() => setShopItem(null)}>
          <div className="dl-modal dl-shopsheet" role="dialog" aria-modal="true" aria-label="Product" onClick={(e) => e.stopPropagation()}>
            <button className="dl-modal-x" aria-label="Close" onClick={() => setShopItem(null)}>×</button>
            <h2>{shopItem.product.name || "Untitled product"}</h2>
            {shopItem.product.price && <p className="dl-shopprice">{shopItem.product.price}</p>}
            <p className="dl-shopnote">Sold through Fourthwall — checkout, payment, and shipping are handled there.</p>
            <button className="dl-buy" onClick={() => buy(shopItem)}>Buy on Fourthwall ↗</button>
          </div>
        </div>
      )}

      {modal && (
        <div className="dl-modal-veil" onClick={() => setModal(false)}>
          <div className="dl-modal" role="dialog" aria-modal="true" aria-label="About and contact" onClick={(e) => e.stopPropagation()}>
            <button className="dl-modal-x" aria-label="Close" onClick={() => setModal(false)}>×</button>
            <h2>One canvas per day.</h2>
            <p>
              Daylog is a running visual diary. Drag images onto the page and they land on today's canvas;
              the days become one continuous scroll back through time.
            </p>
            <p>Some images go deeper — a title chip opens the full project page. Some are for sale — look for the Shop chip.</p>
            <h3>Contact</h3>
            <p className="dl-contact">
              <a href="mailto:hello@example.com">hello@example.com</a>
            </p>
            <p className="dl-hint">⌘/Ctrl + Shift + L — log in or out</p>
          </div>
        </div>
      )}
    </div>
  );
}
