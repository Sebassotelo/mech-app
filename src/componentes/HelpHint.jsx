"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function HelpHint({
  title = "Ayuda",
  description = "",
  sections = [],
  align = "right",
  buttonClassName = "",
  panelClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const [panelShift, setPanelShift] = useState(0);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const validSections = useMemo(
    () =>
      (Array.isArray(sections) ? sections : []).filter(
        (section) => section?.label && section?.value,
      ),
    [sections],
  );
  const summaryText = useMemo(() => {
    const clean = (value) => String(value || "").trim();
    const shortDescription = clean(description);
    if (shortDescription) {
      return shortDescription;
    }

    const firstSection = clean(validSections[0]?.value);
    if (firstSection) {
      return firstSection;
    }

    return "Información breve de esta sección.";
  }, [description, validSections]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelShift(0);
      return;
    }

    let frameId = null;

    function updatePanelPosition() {
      const panel = panelRef.current;
      if (!panel) return;

      const rect = panel.getBoundingClientRect();
      const viewportPadding = 10;
      let nextShift = 0;

      if (rect.right > window.innerWidth - viewportPadding) {
        nextShift -= rect.right - (window.innerWidth - viewportPadding);
      }

      if (rect.left < viewportPadding) {
        nextShift += viewportPadding - rect.left;
      }

      setPanelShift(nextShift);
    }

    frameId = window.requestAnimationFrame(updatePanelPosition);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, align, title, description, validSections]);

  const panelAlignClass =
    align === "left"
      ? "left-0"
      : align === "center"
        ? "left-1/2"
        : "right-0";
  const baseTranslateX = align === "center" ? "-50%" : "0px";
  const arrowAlignClass =
    align === "left"
      ? "left-3"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "right-3";
  const panelOriginClass =
    align === "left"
      ? "origin-top-left"
      : align === "center"
        ? "origin-top"
        : "origin-top-right";

  return (
    <div className="relative inline-flex shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={`Ayuda sobre ${title}`}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] text-[11px] font-semibold text-white/55 transition duration-150 hover:border-white/14 hover:bg-white/[0.08] hover:text-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EE7203]/45 active:scale-[0.98] ${open ? "border-white/16 bg-white/[0.1] text-white/88" : ""} ${buttonClassName}`}
      >
        <span className="translate-y-[-0.5px]">?</span>
      </button>

      {open && (
        <div className={`absolute top-[calc(100%+0.2rem)] z-[90] ${panelAlignClass}`}>
          <div
            className={`pointer-events-none absolute top-0 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-l border-t border-white/10 bg-[#143244] ${arrowAlignClass}`}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            style={{
              transform:
                align === "center"
                  ? `translateX(calc(${baseTranslateX} + ${panelShift}px))`
                  : `translateX(${panelShift}px)`,
            }}
            className={`animate-in fade-in zoom-in-95 duration-150 w-[min(78vw,15rem)] rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(20,50,68,0.98),rgba(11,29,40,0.98))] px-3.5 py-3 text-left shadow-[0_22px_46px_rgba(0,0,0,0.38)] backdrop-blur-xl ${panelOriginClass} ${panelClassName}`}
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/38">
              Ayuda
            </p>
            <h4 className="mt-0.5 text-[13px] font-semibold leading-5 text-white">
              {title}
            </h4>
            <p className="mt-1.5 text-[12px] leading-5 text-white/68">
              {summaryText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
