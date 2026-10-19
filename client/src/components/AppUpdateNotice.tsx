import { useEffect, useRef, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  APP_UPDATE_INTERVAL_MS,
  APP_UPDATE_TIMEOUT_MS,
  createAppUpdateMonitor,
  readAppVersion,
} from "@/lib/appUpdate";
import type { AppVersion } from "@shared/appVersion";
import { getPendingWriteCount, usePendingWriteCount } from "@/lib/pendingWrites";

export function AppUpdateNotice() {
  const queryClient = useQueryClient();
  const mutations = useIsMutating();
  const pendingWrites = usePendingWriteCount();
  const [update, setUpdate] = useState<AppVersion | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const edited = useRef(false);
  const mounted = useRef(false);
  const reloadRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    // Development uses HMR. Only real built releases advertise updates.
    if (!import.meta.env.PROD) return;
    mounted.current = true;
    const active = () =>
      document.visibilityState !== "hidden" && navigator.onLine;
    const monitor = createAppUpdateMonitor({
      currentBuildId: __APP_BUILD_ID__,
      onUpdate: setUpdate,
      isActive: active,
      intervalMs: APP_UPDATE_INTERVAL_MS + Math.round(Math.random() * 10_000),
    });
    const check = () => {
      void monitor.check();
    };
    const rememberEdit = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input,select,textarea,[contenteditable='true']")
      )
        edited.current = true;
    };
    const rememberFileDrop = (event: DragEvent) => {
      if (event.dataTransfer?.files.length) edited.current = true;
    };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    document.addEventListener("input", rememberEdit, true);
    document.addEventListener("change", rememberEdit, true);
    document.addEventListener("drop", rememberFileDrop, true);
    return () => {
      mounted.current = false;
      monitor.stop();
      reloadRequest.current?.abort();
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      document.removeEventListener("input", rememberEdit, true);
      document.removeEventListener("change", rememberEdit, true);
      document.removeEventListener("drop", rememberFileDrop, true);
    };
  }, []);

  async function refresh(confirmed = false) {
    if (
      reloadRequest.current ||
      queryClient.isMutating() ||
      getPendingWriteCount()
    )
      return;
    const controller = new AbortController();
    reloadRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), APP_UPDATE_TIMEOUT_MS);
    setChecking(true);
    setMessage("");
    try {
      // Re-check readiness: a notice may remain visible while offline or while
      // an operator pauses traffic for a subsequent release.
      const latest = await readAppVersion(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (!latest || latest.buildId === __APP_BUILD_ID__) {
        setMessage(
          "Yangilanish hali tayyor emas. Birozdan keyin qayta urinib ko‘ring."
        );
        return;
      }
      if (queryClient.isMutating() || getPendingWriteCount()) {
        setMessage(
          "Ma’lumotlar saqlanmoqda. Tugashini kuting, so‘ng yangilang."
        );
        return;
      }
      if (edited.current && !confirmed) {
        setConfirming(true);
        return;
      }
      // Keep the URL, login cookies and all saved server data. Existing native
      // beforeunload protections remain in effect for dirty settings forms.
      window.location.reload();
    } catch {
      if (mounted.current)
        setMessage(
          "Yangilanishni tekshirib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring."
        );
    } finally {
      clearTimeout(timeout);
      if (reloadRequest.current === controller) reloadRequest.current = null;
      if (mounted.current) setChecking(false);
    }
  }

  if (!update) return null;
  const saving = mutations > 0 || pendingWrites > 0;
  const busy = saving || checking;
  return (
    <>
      <aside
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Sayt yangilanishi"
        className="fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] rounded-xl border border-primary/25 bg-card p-4 text-card-foreground shadow-lg sm:max-w-sm"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-primary/10 p-2 text-primary">
            <Sparkles aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Saytning yangi versiyasi tayyor
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Yangi imkoniyatlar va tuzatishlardan foydalanish uchun saytni
              yangilang. Sahifa o‘z-o‘zidan yangilanmaydi.
            </p>
          </div>
        </div>
        {message && (
          <p className="mt-3 text-xs leading-5 text-destructive">{message}</p>
        )}
        <Button
          type="button"
          className="mt-3 w-full gap-2"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-4 ${checking ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          {saving
            ? "Saqlash tugashini kuting…"
            : checking
              ? "Tekshirilmoqda…"
              : "Yangilash"}
        </Button>
      </aside>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Yangilashdan oldin yozuvlaringizni saqlang
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bu sahifada ma’lumot kiritgansiz. Saqlanmagan yozuvlar qayta
              yuklashda yo‘qolishi mumkin. Saqlagan bo‘lsangiz, davom eting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={
              checking || message || saving
                ? `text-sm ${message ? "text-destructive" : "text-muted-foreground"}`
                : "sr-only"
            }
          >
            {checking
              ? "Yangilanish tekshirilmoqda…"
              : message ||
                (saving
                  ? "Ma’lumotlar saqlanmoqda. Tugashini kuting, so‘ng yangilang."
                  : "")}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={checking}>
              Sahifada qolish
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={event => {
                event.preventDefault();
                void refresh(true);
              }}
            >
              Saqladim, yangilash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
