"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** Reference motion is scoped to the landing page; it never drives job state. */
export function useReferenceMotion(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    let disposed = false;
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const paths = root.querySelectorAll<SVGPathElement>(".rf-constellation-lines path");
      paths.forEach(path => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
      });
      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro.from(".rf-header", { opacity: 0, y: -12, duration: .8 }, 0)
        .from(".rf-title-inner", { yPercent: 115, duration: 1.1, stagger: .09, ease: "power4.out" }, .15)
        .from(".rf-hero-desc, .rf-hero-cta, .rf-under-link", { opacity: 0, y: 22, duration: .8, stagger: .1 }, .75)
        .from(".rf-tile", { opacity: 0, scale: 0, duration: 1.25, stagger: { each: .075, from: "center" }, ease: "elastic.out(1,.65)" }, .45)
        .to(paths, { strokeDashoffset: 0, duration: 1.4, stagger: .065, ease: "power2.inOut" }, .8)
        .from(".rf-map-caption, .rf-map-detail", { opacity: 0, y: 12, duration: .7, stagger: .12 }, 1.65)
        .from(".rf-pill", { y: 25, scale: .65, opacity: 0, duration: .8, stagger: .1, ease: "back.out(1.6)" }, 1.65);
      root.querySelectorAll<HTMLElement>(".rf-reveal-title").forEach(title => {
        gsap.from(title.querySelectorAll(".rf-word > span"), { yPercent: 112, duration: 1, stagger: .04, ease: "power4.out", scrollTrigger: { trigger: title, start: "top 90%", once: true } });
      });
      gsap.from(".rf-feature-wrap", { y: 65, opacity: 0, duration: .9, stagger: .15, scrollTrigger: { trigger: ".rf-feature-cards", start: "top 87%", once: true } });
      gsap.from(".rf-change-words", { scale: .88, opacity: 0, duration: 1.1, ease: "elastic.out(1,.7)", scrollTrigger: { trigger: ".rf-change-words", start: "top 87%", once: true } });
      gsap.from(".rf-final-card", { scale: .94, y: 30, opacity: 0, duration: 1.1, scrollTrigger: { trigger: ".rf-final-card", start: "top 88%", once: true } });
      root.querySelectorAll<HTMLElement>(".rf-stat-number").forEach(element => {
        const value = Number(element.dataset.num);
        const counter = { value: 0 };
        gsap.to(counter, { value, duration: 1.6, ease: "power2.out", scrollTrigger: { trigger: element, start: "top 88%", once: true }, onUpdate: () => { element.textContent = String(Math.round(counter.value)).padStart(2, "0"); } });
      });
      return () => {
        paths.forEach(p => { p.style.removeProperty("stroke-dasharray"); p.style.removeProperty("stroke-dashoffset"); });
        root.querySelectorAll<HTMLElement>(".rf-stat-number").forEach(el => { el.textContent = (el.dataset.num || "0").padStart(2, "0"); });
      };
    }, root);
    media.add("(min-width: 1000px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)", () => {
      gsap.to(".rf-hero-right", { y: 75, scale: .96, ease: "none", scrollTrigger: { trigger: ".rf-hero", start: "top top", end: "bottom top", scrub: 1 } });
      gsap.to(".rf-hero-copy", { y: 45, opacity: .45, ease: "none", scrollTrigger: { trigger: ".rf-hero", start: "top top", end: "bottom top", scrub: 1 } });
      const cleanup: (() => void)[] = [];
      root.querySelectorAll<HTMLElement>(".rf-constellation, .rf-feature-card").forEach(surface => {
        const target = surface.querySelector<HTMLElement>(".rf-constellation-inner") || surface;
        const move = (event: PointerEvent) => {
          if (event.pointerType !== "mouse") return;
          const box = surface.getBoundingClientRect();
          const x = (event.clientX - box.left) / box.width - .5;
          const y = (event.clientY - box.top) / box.height - .5;
          target.style.setProperty("--rx", `${-y * 8}deg`);
          target.style.setProperty("--ry", `${x * 12}deg`);
          target.style.setProperty("--lift", surface === target ? "-10px" : "0px");
        };
        const leave = () => { target.style.removeProperty("--rx"); target.style.removeProperty("--ry"); target.style.removeProperty("--lift"); };
        surface.addEventListener("pointermove", move, { passive: true });
        surface.addEventListener("pointerleave", leave);
        cleanup.push(() => { leave(); surface.removeEventListener("pointermove", move); surface.removeEventListener("pointerleave", leave); });
      });
      const cursor = root.querySelector<HTMLElement>(".rf-cursor")!;
      gsap.set(cursor, { xPercent: -50, yPercent: -50 });
      const xTo = gsap.quickTo(cursor, "x", { duration: .28, ease: "power3.out" });
      const yTo = gsap.quickTo(cursor, "y", { duration: .28, ease: "power3.out" });
      const moveCursor = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const first = root.dataset.cursor !== "on";
        root.dataset.cursor = "on";
        if (first) gsap.set(cursor, { x: event.clientX, y: event.clientY });
        xTo(event.clientX); yTo(event.clientY);
        cursor.dataset.expanded = event.target instanceof Element && !!event.target.closest("a, button, .rf-feature-card") ? "true" : "false";
      };
      const hideCursor = () => { delete root.dataset.cursor; };
      root.addEventListener("pointermove", moveCursor, { passive: true });
      root.addEventListener("pointerleave", hideCursor);
      window.addEventListener("blur", hideCursor);
      return () => { cleanup.forEach(fn => fn()); hideCursor(); root.removeEventListener("pointermove", moveCursor); root.removeEventListener("pointerleave", hideCursor); window.removeEventListener("blur", hideCursor); };
    }, root);
    void document.fonts.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    return () => { disposed = true; media.revert(); };
  }, [enabled]);
  return ref;
}
