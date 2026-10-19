import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

/** Forms stay mounted; optional exit presence preserves read-only detail panels
 * just long enough to close, then restores their original unmount behavior. */
export function AnimatedPanel({
  open,
  children,
  unmountOnExit = false,
  className,
  ...props
}: ComponentProps<"div"> & {
  open: boolean;
  unmountOnExit?: boolean;
}) {
  const previous = useRef(children);
  useLayoutEffect(() => {
    if (open) previous.current = children;
  }, [open, children]);
  if (unmountOnExit)
    return (
      <CollapsiblePrimitive.Root open={open} asChild>
        <CollapsiblePrimitive.Content
          {...props}
          className={cn("app-fold-content app-collapsible-content", className)}
          aria-hidden={!open}
          inert={!open}
        >
          {open ? children : previous.current}
        </CollapsiblePrimitive.Content>
      </CollapsiblePrimitive.Root>
    );
  return (
    <div
      {...props}
      className={cn("app-expand-panel", className)}
      data-expanded={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="app-expand-inner">{children}</div>
    </div>
  );
}

export function AnimatedDisclosure({
  title,
  children,
  className,
  triggerClassName,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className} data-expanded={open}>
      <button
        type="button"
        className={cn("app-disclosure-trigger", triggerClassName)}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(value => !value)}
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className="app-disclosure-chevron size-4 shrink-0"
        />
      </button>
      <AnimatedPanel id={id} open={open}>
        {children}
      </AnimatedPanel>
    </div>
  );
}

/** Keep the existing one-line ellipsis while animating to the full note's real
 * height. Observe wrapping/font changes rather than guessing a maximum height. */
export function ExpandableNote({
  text,
  expanded,
  onToggle,
}: {
  text: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const content = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setHeight(element.scrollHeight);
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text]);
  return (
    <button
      type="button"
      className="app-expand-note block max-w-64 text-left"
      style={{ height: expanded ? height : "1.5em" }}
      onClick={onToggle}
      aria-expanded={expanded}
      title={text}
    >
      <span
        ref={content}
        className="app-expand-note-full block whitespace-pre-wrap break-words"
        aria-hidden={!expanded}
        data-expanded={expanded}
      >
        {text}
      </span>
      <span
        className="app-expand-note-preview truncate"
        aria-hidden={expanded}
        data-expanded={expanded}
      >
        {text}
      </span>
    </button>
  );
}
