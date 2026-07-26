import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_32%),linear-gradient(135deg,#f8fafc,#fff7ed)] p-6">
          <div className="flex w-full max-w-xl flex-col items-center rounded-[28px] bg-white/90 p-8 text-center shadow-[0_28px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:p-12">
            <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-50 text-amber-600">
              <AlertTriangle size={38} className="flex-shrink-0" />
            </div>

            <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-amber-700">Tizim xabari</p>
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Kutilmagan xatolik yuz berdi</h2>
            <p className="mb-8 max-w-md leading-7 text-slate-500">
              Sahifani qayta yuklab ko‘ring. Muammo davom etsa, tizim administratoriga xabar bering.
            </p>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex h-11 cursor-pointer items-center gap-2 rounded-xl px-5",
                "bg-slate-950 text-white shadow-lg shadow-slate-950/15",
                "transition-transform duration-150 active:scale-[0.97] hover:bg-slate-800"
              )}
            >
              <RotateCcw size={16} />
              Sahifani qayta yuklash
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
