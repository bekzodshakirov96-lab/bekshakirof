import { Check } from "lucide-react";

/** Visual mark for a parent checkbox button; never nests another control. */
export function SelectionMark({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden="true" className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-transparent"}`}>
      {checked ? <Check className="size-3.5" /> : null}
    </span>
  );
}
