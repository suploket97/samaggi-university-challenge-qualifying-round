"use client";
import { useRef, useState } from "react";

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Drag-to-reorder for a vertical list, with pointer events so it works with a
 * mouse and on touch screens. Each item carries data-sortable-item={index};
 * each item's grab handle spreads handleProps(index). While dragging, render
 * `order` (indices in preview order) so the list rearranges live. The handle
 * also moves its item with the ↑/↓ keys.
 */
export function useSortable(count: number, onDrop: (from: number, to: number) => void) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const order = Array.from({ length: count }, (_, i) => i);
  if (drag && drag.from < count) {
    order.splice(drag.from, 1);
    order.splice(Math.min(drag.to, order.length), 0, drag.from);
  }

  function handleProps(index: number) {
    return {
      role: "button",
      tabIndex: 0,
      "aria-label": "Drag to reorder (or use the arrow keys)",
      title: "Drag to reorder",
      style: { touchAction: "none", cursor: drag ? "grabbing" : "grab" } as React.CSSProperties,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "ArrowUp" && index > 0) {
          e.preventDefault();
          onDrop(index, index - 1);
        } else if (e.key === "ArrowDown" && index < count - 1) {
          e.preventDefault();
          onDrop(index, index + 1);
        }
      },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        // Listen on the window, not the handle: React moves the row in the page while
        // previewing, and moving an element drops any pointer capture it had.
        let to = index;
        setDrag({ from: index, to });

        const move = (ev: PointerEvent) => {
          const list = listRef.current;
          if (!list) return;
          // Target slot = how many of the other items sit above the pointer.
          let n = 0;
          list.querySelectorAll<HTMLElement>(":scope > [data-sortable-item]").forEach((el) => {
            if (Number(el.dataset.sortableItem) === index) return;
            const r = el.getBoundingClientRect();
            if (ev.clientY > r.top + r.height / 2) n++;
          });
          if (n !== to) {
            to = n;
            setDrag({ from: index, to });
          }
          // Scroll the page when dragging near the top or bottom edge.
          if (ev.clientY < 70) window.scrollBy(0, -14);
          else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          document.body.style.removeProperty("user-select");
          setDrag(null);
          if (to !== index) onDrop(index, to);
        };
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      },
    };
  }

  return { listRef, order, dragging: drag ? drag.from : null, handleProps };
}

/** The six-dot grab handle drawn on each draggable row. */
export const GRIP = "⠿";
