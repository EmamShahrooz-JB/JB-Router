"use client";

/**
 * SelectMenuEnhancer — replaces the browser's native <select> popup with a
 * styled, searchable listbox while keeping every existing <select> in the app
 * untouched (no call-site changes, React onChange handlers still fire).
 *
 * Why: the native popup cannot be styled. In dark mode it rendered as an
 * unstyled white sheet, ignored the theme, had no hover state, no search for the
 * long provider/model lists, no grouping affordance and no keyboard niceties
 * beyond the browser defaults.
 *
 * How: a single client component mounted once in the root layout intercepts
 * pointer/keyboard activation of any <select> element, renders a glass panel
 * (portal to <body>, fixed positioning with viewport flip) and writes the choice
 * back to the real <select> by setting `.value` and dispatching native
 * `input` + `change` events, so React's onChange and any other listener runs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MENU_MIN_WIDTH = 240;
const MENU_GAP = 6;
const SEARCH_THRESHOLD = 8;

function readOptions(select) {
  const out = [];
  for (const child of Array.from(select.children)) {
    if (child.tagName === "OPTGROUP") {
      const groupLabel = child.label || "";
      for (const option of Array.from(child.children)) {
        out.push({
          value: option.value,
          label: option.textContent || option.value,
          hint: option.title || "",
          disabled: option.disabled,
          group: groupLabel,
          placeholder: false,
        });
      }
      continue;
    }
    if (child.tagName !== "OPTION") continue;
    const isPlaceholder = child.value === "" || child.dataset?.jbPlaceholder === "1";
    out.push({
      value: child.value,
      label: child.textContent || child.value,
      hint: child.title || "",
      disabled: child.disabled,
      group: "",
      placeholder: isPlaceholder,
    });
  }
  return out;
}

function isEnhanceable(select) {
  if (!select || select.tagName !== "SELECT") return false;
  if (select.disabled || select.multiple) return false;
  if (Number(select.getAttribute("size") || 0) > 1) return false;
  if (select.dataset.jbNativeMenu === "1") return false;
  if (select.options.length === 0) return false;
  return true;
}

export default function SelectMenuEnhancer() {
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const typeaheadRef = useRef({ text: "", at: 0 });

  const close = useCallback((refocus = true) => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    if (current?.select) {
      current.select.removeAttribute("aria-expanded");
      if (refocus) {
        try { current.select.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    }
  }, []);

  const commit = useCallback((value) => {
    const current = sessionRef.current;
    if (!current) return;
    const { select } = current;
    close();
    if (select.value === value) return;
    select.value = value;
    // Native events so React's onChange and every other listener sees the change.
    select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }, [close]);

  const open = useCallback((select, key) => {
    const options = readOptions(select);
    if (options.length === 0) return;
    const rect = select.getBoundingClientRect();
    const viewportH = window.innerHeight || 800;
    const width = Math.max(rect.width, MENU_MIN_WIDTH);
    const left = Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - width - 8, 8));

    const startedIndex = options.findIndex((option) => option.value === select.value && !option.disabled);
    const filtered = options.filter((option) => !option.placeholder);
    const index = Math.max(filtered.findIndex((option) => option.value === select.value), 0);

    setSession({
      select,
      options,
      index,
      rect,
      width,
      left,
      flipUp: key === "flipUp",
      viewportH,
      search: options.length > SEARCH_THRESHOLD,
      query: "",
      startedIndex,
    });
    sessionRef.current = { select, options };
    select.setAttribute("aria-haspopup", "listbox");
    select.setAttribute("aria-expanded", "true");
  }, []);

  // Position tracker: recompute on scroll/resize, close on outside interaction.
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!session) return undefined;
    const onScroll = () => setFrame((n) => n + 1);
    const onKey = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [session, close]);

  useEffect(() => {
    if (!session) return;
    // Focus the search box, or the panel itself so arrow keys / typeahead reach
    // the menu instead of the (now inert) native select.
    if (session.search) searchRef.current?.focus({ preventScroll: true });
    else panelRef.current?.focus({ preventScroll: true });
  }, [session]);

  // Activation: pointer + keyboard on any <select> in the document.
  useEffect(() => {
    const onPointerDown = (event) => {
      const target = event.target instanceof Element ? event.target.closest("select") : null;
      if (!target || !isEnhanceable(target)) return;
      // Let the click fall through to the rest of the page (labels, handlers),
      // but stop the browser from opening its own popup.
      event.preventDefault();
      if (sessionRef.current?.select === target) { close(); return; }
      open(target);
    };

    const onKeyDown = (event) => {
      const target = event.target instanceof Element ? event.target.closest("select") : null;
      if (!target || !isEnhanceable(target)) return;
      if (event.key === "Tab" || event.key === "Escape") return;
      const opens = event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "F4";
      if (!opens) return;
      event.preventDefault();
      if (sessionRef.current?.select === target) { close(); return; }
      open(target, event.key === "ArrowUp" ? "flipUp" : undefined);
    };

    // PointerEvent-capable browsers only listen to pointerdown: listening to both
    // would open the menu on pointerdown and immediately close it on mousedown.
    const pressEvent = typeof window !== "undefined" && "PointerEvent" in window ? "pointerdown" : "mousedown";
    document.addEventListener(pressEvent, onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener(pressEvent, onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const visible = useMemo(() => {
    if (!session) return [];
    const query = session.query.trim().toLowerCase();
    return session.options
      .map((option, rawIndex) => ({ ...option, rawIndex }))
      .filter((option) => !query || option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query));
  }, [session]);

  const selectableRows = useMemo(() => visible.filter((option) => !option.disabled), [visible]);

  const move = useCallback((delta) => {
    setSession((prev) => {
      if (!prev) return prev;
      const rows = prev.options
        .map((option, rawIndex) => ({ ...option, rawIndex }))
        .filter((option) => !option.disabled && (!prev.query.trim() || option.label.toLowerCase().includes(prev.query.trim().toLowerCase())));
      if (rows.length === 0) return prev;
      const currentPos = rows.findIndex((row) => row.rawIndex === prev.index);
      const nextPos = currentPos < 0
        ? (delta > 0 ? 0 : rows.length - 1)
        : (currentPos + delta + rows.length) % rows.length;
      return { ...prev, index: rows[nextPos].rawIndex };
    });
  }, []);

  // Menu keyboard handling (search input included).
  const onMenuKeyDown = useCallback((event) => {
    if (!session) return;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home": event.preventDefault(); move(-9999); break;
      case "End": event.preventDefault(); move(9999); break;
      case "PageDown": event.preventDefault(); move(8); break;
      case "PageUp": event.preventDefault(); move(-8); break;
      case "Enter": {
        event.preventDefault();
        const option = visible.find((item) => item.rawIndex === session.index);
        if (option && !option.disabled) commit(option.value);
        break;
      }
      case "Escape": event.preventDefault(); close(); break;
      case "Tab": close(false); break;
      default: {
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) break;
        const now = Date.now();
        const { text, at } = typeaheadRef.current;
        const nextText = (now - at < 700 ? text : "") + event.key;
        typeaheadRef.current = { text: nextText, at: now };
        const needle = nextText.toLowerCase();
        const match = visible.find((item) => !item.disabled && item.label.toLowerCase().startsWith(needle));
        if (match) setSession((prev) => (prev ? { ...prev, index: match.rawIndex } : prev));
      }
    }
  }, [session, visible, move, commit, close]);

  useEffect(() => {
    if (!session) return;
    const node = panelRef.current?.querySelector(".jb-menu-item[data-active='true']");
    node?.scrollIntoView({ block: "nearest" });
  }, [session, frame]);

  // Keep the panel glued to its select while scrolling.
  const geometry = useMemo(() => {
    if (!session) return null;
    const rect = session.select.getBoundingClientRect();
    const rows = Math.min(session.options.length, 9);
    const estimated = 16 + (session.search ? 46 : 0) + rows * 38;
    const spaceBelow = (window.innerHeight || 800) - rect.bottom;
    const flipUp = session.flipUp || (spaceBelow < estimated + MENU_GAP && rect.top > spaceBelow);
    return {
      left: Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - Math.max(rect.width, MENU_MIN_WIDTH) - 8, 8)),
      width: Math.max(rect.width, MENU_MIN_WIDTH),
      top: flipUp ? undefined : rect.bottom + MENU_GAP,
      bottom: flipUp ? (window.innerHeight || 800) - rect.top + MENU_GAP : undefined,
      maxHeight: Math.max(180, Math.min(420, (flipUp ? rect.top : spaceBelow) - MENU_GAP - 12)),
    };
  }, [session, frame]);

  if (!session || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="jb-menu-backdrop"
        onPointerDown={(event) => { event.preventDefault(); close(); }}
      />
      <div
        ref={panelRef}
        className={`jb-menu${geometry.bottom !== undefined ? " jb-menu--up" : ""}`}
        style={{
          left: geometry.left,
          width: geometry.width,
          top: geometry.top,
          bottom: geometry.bottom,
          maxHeight: geometry.maxHeight,
        }}
        role="listbox"
        aria-label={session.select.getAttribute("aria-label") || session.select.name || "Options"}
        onKeyDown={onMenuKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        {session.search && (
          <div className="jb-menu-search">
            <span className="material-symbols-outlined text-[16px]">search</span>
            <input
              ref={searchRef}
              value={session.query}
              placeholder="Search..."
              onChange={(event) => setSession((prev) => (prev ? { ...prev, query: event.target.value, index: -1 } : prev))}
              onKeyDown={onMenuKeyDown}
            />
            <span className="jb-menu-count">{visible.length}</span>
          </div>
        )}
        <div className="jb-menu-list">
          {visible.length === 0 && (
            <div className="jb-menu-empty">
              <span className="material-symbols-outlined text-[16px]">search_off</span>
              No matches
            </div>
          )}
          {visible.map((option, i) => {
            const previous = visible[i - 1];
            const showGroup = option.group && (!previous || previous.group !== option.group);
            const isSelected = option.value === session.select.value && !option.placeholder;
            const isActive = option.rawIndex === session.index;
            return (
              <div key={`${option.group}:${option.value}:${option.rawIndex}`}>
                {showGroup && <div className="jb-menu-group">{option.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  data-active={isActive ? "true" : "false"}
                  className={`jb-menu-item${isSelected ? " jb-menu-item--selected" : ""}`}
                  onMouseEnter={() => setSession((prev) => (prev ? { ...prev, index: option.rawIndex } : prev))}
                  onClick={() => commit(option.value)}
                >
                  <span className="jb-menu-item-label">
                    {option.label}
                    {option.hint && <span className="jb-menu-item-hint">{option.hint}</span>}
                  </span>
                  {isSelected && (
                    <span className="material-symbols-outlined jb-menu-item-check">check</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        {selectableRows.length > 0 && (
          <div className="jb-menu-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> select</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
