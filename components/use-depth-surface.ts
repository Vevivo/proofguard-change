"use client";

import { useEffect, useRef } from "react";

/** Pointer lighting stays outside React state. At most one card updates per frame. */
export function useDepthSurface() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const preference = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let active: HTMLElement | null = null;
    let frame = 0;
    let x = 0, y = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (active) {
        active.removeAttribute("data-lit");
        for (const name of ["--light-x", "--light-y", "--tilt-x", "--tilt-y"]) active.style.removeProperty(name);
      }
      active = null;
    };
    const render = () => {
      frame = 0;
      if (!active?.isConnected) { reset(); return; }
      const box = active.getBoundingClientRect();
      const px = Math.max(0, Math.min(1, (x - box.left) / Math.max(box.width, 1)));
      const py = Math.max(0, Math.min(1, (y - box.top) / Math.max(box.height, 1)));
      active.style.setProperty("--light-x", `${(px * 100).toFixed(1)}%`);
      active.style.setProperty("--light-y", `${(py * 100).toFixed(1)}%`);
      active.style.setProperty("--tilt-x", `${((.5 - py) * 3).toFixed(2)}deg`);
      active.style.setProperty("--tilt-y", `${((px - .5) * 3).toFixed(2)}deg`);
      active.setAttribute("data-lit", "true");
    };
    const move = (event: PointerEvent) => {
      if (!preference.matches || event.pointerType === "touch") { reset(); return; }
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".nw-job, .nw-source-node, .nw-button:not(:disabled)") : null;
      if (!target || !root.contains(target)) { reset(); return; }
      if (active !== target) { reset(); active = target; }
      x = event.clientX; y = event.clientY;
      if (!frame) frame = requestAnimationFrame(render);
    };
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", reset);
    root.addEventListener("pointercancel", reset);
    preference.addEventListener("change", reset);
    window.addEventListener("blur", reset);
    // A scenario/tab change may remove a lit card while the pointer is stationary.
    const observer = new MutationObserver(() => { if (active && !root.contains(active)) reset(); });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      reset(); observer.disconnect();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", reset);
      root.removeEventListener("pointercancel", reset);
      preference.removeEventListener("change", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return ref;
}
