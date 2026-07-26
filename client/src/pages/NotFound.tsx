import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(8,145,178,0.12),transparent_34%),linear-gradient(135deg,#f8fafc,#eef2ff)] px-4">
      <Card className="w-full max-w-lg overflow-hidden rounded-[28px] border-0 bg-white/90 shadow-[0_28px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <CardContent className="px-7 py-10 text-center sm:px-12 sm:py-12">
          <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-500/20">
            <ArrowLeft className="h-9 w-9" />
          </div>

          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-cyan-700">Xatolik 404</p>
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Sahifa topilmadi</h1>

          <p className="mb-8 leading-7 text-slate-500">
            Siz ochmoqchi bo‘lgan sahifa mavjud emas, ko‘chirilgan yoki o‘chirilgan bo‘lishi mumkin.
          </p>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="h-11 rounded-xl bg-slate-950 px-6 text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800"
            >
              <Home className="mr-2 h-4 w-4" />
              Boshqaruv paneliga qaytish
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
