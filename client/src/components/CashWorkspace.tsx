import { Button } from "@/components/ui/button";
import {
  Calculator,
  Expand,
  Minimize2,
  Rows3,
  WalletCards,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import "./cash-workspace.css";
import { AnimatedDisclosure } from "./ui/expandable";

/** Presentation only. Both tables and control forms remain mounted when hidden,
 * so switching views cannot discard drafts or interrupt their existing savers. */
export function CashWorkspace({
  header,
  preview,
  metrics,
  pending,
  actual,
  journal,
  matrix,
  date,
  actualStatus,
  pendingStatus,
}: {
  header: ReactNode;
  preview?: ReactNode;
  metrics: ReactNode;
  pending: ReactNode;
  actual: ReactNode;
  journal: ReactNode;
  matrix?: ReactNode;
  date: string;
  actualStatus?: ReactNode;
  pendingStatus?: ReactNode;
}) {
  const [view, setView] = useState<"journal" | "matrix">("journal");
  const [both, setBoth] = useState(false);
  const [comfortable, setComfortable] = useState(false);
  const [focused, setFocused] = useState(false);
  const id = useId();
  const selected = matrix ? view : "journal";
  const tabs: Array<"journal" | "matrix"> = matrix
    ? ["journal", "matrix"]
    : ["journal"];
  return (
    <div
      className="cash-workspace mx-auto w-full max-w-none"
      data-density={comfortable ? "comfortable" : "compact"}
      data-focused={focused}
    >
      <div className="cash-workspace-heading">
        {header}
        <div className="cash-workspace-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={comfortable}
            onClick={() => setComfortable(value => !value)}
            title="Ixcham yoki qulay qatorlar"
          >
            <Rows3 className="size-3.5" />
            {comfortable ? "Qulay qatorlar" : "Ixcham qatorlar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={focused}
            onClick={() => setFocused(value => !value)}
          >
            {focused ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Expand className="size-3.5" />
            )}
            {focused ? "Oddiy ko‘rinish" : "Diqqat rejimi"}
          </Button>
        </div>
      </div>
      {preview}
      <div className="cash-date-caption">
        Kassa va kunlik jurnal sanasi{" "}
        <strong>{date.split("-").reverse().join(".")}</strong>
      </div>
      {/* Transparent metric children must share the parent's company card palette. */}
      <div className="cash-metrics bg-card text-card-foreground">{metrics}</div>
      <div className="cash-control-panels">
        <AnimatedDisclosure className="cash-disclosure" title={
            <span>
              <Calculator className="size-4" />
              <strong>Naqd pulni solishtirish</strong>
              <span className="cash-summary-hint">
                Haqiqiy sanalgan summa bilan nazorat
              </span>
              {actualStatus}
            </span>
        }>
          {actual}
        </AnimatedDisclosure>
        <AnimatedDisclosure className="cash-disclosure" title={
            <span>
              <WalletCards className="size-4" />
              <strong>Jurnal nazorati</strong>
              <span className="cash-summary-hint">
                Agent × Tovar va jurnal kanallari
              </span>
              {pendingStatus}
            </span>
        }>
          {pending}
        </AnimatedDisclosure>
      </div>
      <div className="cash-view-toolbar">
        <div
          role="tablist"
          aria-label="Kassa jadvallari"
          className="cash-view-tabs"
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const index = tabs.indexOf(selected);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            const tab = tabs[next];
            setView(tab);
            document.getElementById(`${id}-${tab}-tab`)?.focus();
          }}
        >
          {tabs.map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`${id}-${tab}-tab`}
              aria-controls={`${id}-${tab}-panel`}
              aria-selected={selected === tab}
              tabIndex={selected === tab ? 0 : -1}
              onClick={() => setView(tab)}
            >
              {tab === "journal" ? "Kunlik jurnal" : "Agent × Tovar"}
            </button>
          ))}
        </div>
        {matrix && (
          <label className="cash-both-toggle">
            <input
              type="checkbox"
              checked={both}
              onChange={event => setBoth(event.target.checked)}
            />
            Ikkalasini ko‘rsatish
          </label>
        )}
      </div>
      <div
        id={`${id}-journal-panel`}
        role={both ? "region" : "tabpanel"}
        aria-labelledby={`${id}-journal-tab`}
        hidden={!both && selected !== "journal"}
      >
        {journal}
      </div>
      {matrix && (
        <div
          id={`${id}-matrix-panel`}
          role={both ? "region" : "tabpanel"}
          aria-labelledby={`${id}-matrix-tab`}
          hidden={!both && selected !== "matrix"}
        >
          {matrix}
        </div>
      )}
    </div>
  );
}
