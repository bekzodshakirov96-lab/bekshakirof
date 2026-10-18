import { useEffect, useRef, useState, type ReactNode } from "react";
import { clampMatrixColumnWidth, matrixColumnSize, MAX_MATRIX_COLUMN_WIDTH, type MatrixColumnKey } from "@shared/matrixLayout";

export function MatrixColumnHead({ columnKey, label, width, disabled, sticky, children, onPreview, onCommit }: {
  columnKey: MatrixColumnKey; label: string; width: number; disabled: boolean;
  sticky?: boolean; children: ReactNode;
  onPreview: (width: number | null) => void; onCommit: (width: number) => void;
}) {
  const drag = useRef<{ id: number; x: number; width: number; next: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; };
  }, [dragging]);
  const cancel = () => { drag.current = null; setDragging(false); onPreview(null); };
  return (
    <th scope="col" className={`group relative bg-muted px-3 py-2 ${sticky ? "sticky left-0 z-20 text-left" : "text-right"}`}>
      <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap pr-2" title={label}>{children}</div>
      <div role="separator" aria-orientation="vertical" aria-label={`${label}: ustun kengligi`}
        aria-valuemin={matrixColumnSize(columnKey).min} aria-valuemax={MAX_MATRIX_COLUMN_WIDTH}
        aria-valuenow={width} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        title="Ustun kengligini o‘zgartirish uchun suring. ←/→ bilan ham o‘zgartiriladi."
        className={`absolute inset-y-0 right-0 z-30 w-3 touch-none outline-none after:absolute after:inset-y-2 after:right-1 after:w-0.5 after:rounded after:bg-border hover:after:bg-primary focus-visible:after:bg-primary ${disabled ? "cursor-default opacity-30" : "cursor-col-resize"} ${dragging ? "after:bg-primary" : ""}`}
        onPointerDown={event => {
          if (disabled || !event.isPrimary || event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, width, next: width };
          setDragging(true);
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          current.next = clampMatrixColumnWidth(columnKey, current.width + event.clientX - current.x);
          onPreview(current.next);
        }}
        onPointerUp={event => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          const next = clampMatrixColumnWidth(columnKey, current.width + event.clientX - current.x);
          drag.current = null; setDragging(false); onPreview(null);
          if (next !== current.width) onCommit(next);
        }}
        onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
        onKeyDown={event => {
          if (event.key === "Escape" && drag.current) { event.preventDefault(); cancel(); return; }
          if (disabled || drag.current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const next = event.key === "Home" ? matrixColumnSize(columnKey).min : event.key === "End" ? MAX_MATRIX_COLUMN_WIDTH
            : width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 40 : 10);
          if (clampMatrixColumnWidth(columnKey, next) !== width) onCommit(clampMatrixColumnWidth(columnKey, next));
        }} />
    </th>
  );
}
