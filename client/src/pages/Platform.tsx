import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { type Company, type PlatformAccount } from "@shared/platform";

import { AdminConsole } from "./platform/AdminConsole";
import { CompanyCabinet } from "./platform/CompanyCabinet";
import { api, Field, Loading, ErrorMessage } from "./platform/ui";

type Me = { account: PlatformAccount | null; company: Company | null };
export default function Platform() {
  const [location, navigate] = useLocation();
  const cache = useQueryClient();
  const me = useQuery({
    queryKey: ["platform", "me"],
    queryFn: () => api<Me>("/me"),
    retry: false,
  });
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const tokenPage =
    location === "/platforma/tasdiqlash" || location === "/platforma/parol";
  const adminPath = location.startsWith("/super-admin");
  if (me.data?.account?.role === "super_admin" && !tokenPage) {
    return (
      <AdminConsole
        account={me.data.account}
        onLogout={async () => {
          await api("/logout", {});
          cache.removeQueries({ queryKey: ["platform"] });
          navigate("/super-admin");
          await me.refetch();
        }}
      />
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-3 sm:px-7">
          <a
            href={
              me.data?.account?.role === "super_admin"
                ? "/super-admin"
                : "/platforma"
            }
            className="flex items-center gap-3 font-semibold tracking-tight"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <Building2 className="size-5" />
            </span>
            <span>
              BiznesControl
              <span className="block text-xs font-normal tracking-normal text-muted-foreground">
                {adminPath ? "Platforma boshqaruvi" : "Firma kabineti"}
              </span>
            </span>
          </a>
          {me.data?.account ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-sm text-muted-foreground sm:block">
                {me.data.account.name}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  setLogoutError("");
                  try {
                    await api("/logout", {});
                    cache.removeQueries({ queryKey: ["platform"] });
                    navigate(adminPath ? "/super-admin" : "/platforma/kirish");
                    await me.refetch();
                  } catch (error) {
                    setLogoutError((error as Error).message);
                  } finally {
                    setSigningOut(false);
                  }
                }}
              >
                <LogOut className="size-4" /> Chiqish
              </Button>
            </div>
          ) : (
            <Badge variant="outline">
              <ShieldCheck className="mr-1 size-3.5" />{" "}
              {adminPath ? "Super admin" : "1 oy bepul sinov"}
            </Badge>
          )}
        </div>
      </header>
      {logoutError && (
        <div className="mx-auto max-w-3xl p-4">
          <ErrorMessage message={logoutError} />
        </div>
      )}
      <main className="mx-auto max-w-[1440px] px-5 py-6 sm:px-7">
        {tokenPage ? (
          <TokenPage
            kind={location.endsWith("tasdiqlash") ? "verify" : "reset"}
            onDone={() => {
              void me.refetch();
            }}
          />
        ) : me.isPending ? (
          <Loading />
        ) : me.error ? (
          <Card className="mx-auto max-w-lg">
            <CardContent className="space-y-4 pt-6">
              <ErrorMessage message={me.error.message} />
              <Button variant="outline" onClick={() => me.refetch()}>
                Qayta urinish
              </Button>
            </CardContent>
          </Card>
        ) : !me.data?.account ? (
          <AuthForm admin={adminPath} onDone={() => me.refetch()} />
        ) : adminPath && me.data.account.role !== "super_admin" ? (
          <div className="mx-auto max-w-xl space-y-4">
            <ErrorMessage message="Bu panel faqat super admin uchun. Firma administratori platformani boshqara olmaydi." />
            <Button onClick={() => navigate("/platforma")}>
              Firma kabinetiga o‘tish
            </Button>
          </div>
        ) : me.data.account.role === "super_admin" ? (
          <Loading />
        ) : (
          <CompanyCabinet
            account={me.data.account}
            company={me.data.company}
            refresh={() => me.refetch()}
          />
        )}
      </main>
    </div>
  );
}

function AuthForm({
  admin,
  onDone,
}: {
  admin: boolean;
  onDone: () => unknown;
}) {
  const [location, navigate] = useLocation();
  const register = !admin && location === "/platforma/royxat";
  const forgot = location === "/platforma/parol-tiklash";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const capabilities = useQuery({
    queryKey: ["platform", "capabilities"],
    queryFn: () =>
      api<{ registrationEnabled: boolean; emailEnabled: boolean }>(
        "/capabilities"
      ),
    retry: false,
    staleTime: 30_000,
  });
  const unavailable = register
    ? capabilities.data?.registrationEnabled === false
    : forgot && capabilities.data?.emailEnabled === false;
  useEffect(() => {
    setError("");
    setSent(false);
  }, [location]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (forgot) {
        await api("/forgot", { email: values.email });
        setSent(true);
      } else {
        const result = await api<{ mailSent?: boolean }>(
          register ? "/register" : "/login",
          values
        );
        if (result.mailSent === false)
          toast.error(
            "Hisob saqlandi, lekin xat yuborilmadi. Kabinetdan qayta yuboring."
          );
        navigate(admin ? "/super-admin" : "/platforma");
        await onDone();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start ${!register ? "lg:py-12" : ""}`}
    >
      <div className="space-y-6 lg:pt-6">
        <Badge variant="outline" className="px-3 py-1.5 text-primary">
          <ShieldCheck className="mr-2 size-4" />{" "}
          {admin
            ? "Platforma uchun alohida kirish"
            : "O‘zbekiston bizneslari uchun"}
        </Badge>
        <h1 className="max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {admin
            ? "Firmalar va kirish muddatlari bir joyda."
            : "Firmangizning hisob-kitoblari o‘z kabinetingizda."}
        </h1>
        <p className="max-w-md leading-relaxed text-muted-foreground">
          {admin
            ? "Ro‘yxatdan o‘tgan firmalarni kuzating, sinov muddatlari va kirish holatini boshqaring. Barcha boshqaruv amallari tarixda saqlanadi."
            : "Kassa, savdo, ombor va qarzdorlikni bir tizimda yuriting. Har bir firma ma’lumotlari alohida saqlanadi."}
        </p>
        <div className="space-y-4 border-t pt-6 text-sm">
          {(admin
            ? [
                "Firma ma’lumotlari va holati",
                "Sinov muddatlari va kirish nazorati",
                "Boshqaruv amallari tarixi",
              ]
            : [
                "Bir kalendar oy bepul foydalanish",
                "Firmaning o‘z xodimlari va rollari",
                "Ma’lumotlar firmalar bo‘yicha ajratilgan",
              ]
          ).map(text => (
            <p key={text} className="flex items-center gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
              {text}
            </p>
          ))}
        </div>
      </div>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            {forgot
              ? "Parolni tiklash"
              : register
                ? "Firma ochish"
                : admin
                  ? "Super admin kirishi"
                  : "Kabinetga kirish"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {register
              ? "Hisob yarating va emailingizni tasdiqlang. Sinov firma tayyor bo‘lganda boshlanadi."
              : admin
                ? "Platforma operatori yaratgan hisobdan foydalaning."
                : "Platformadagi emailingiz va parolingizni kiriting."}
          </p>
        </CardHeader>
        <CardContent>
          {(register || forgot) && capabilities.isPending ? (
            <Loading />
          ) : (register || forgot) && capabilities.error ? (
            <div className="space-y-4">
              <ErrorMessage message="Platforma holatini tekshirib bo‘lmadi." />
              <Button variant="outline" onClick={() => capabilities.refetch()}>
                Qayta urinish
              </Button>
            </div>
          ) : unavailable ? (
            <div className="space-y-4">
              <p
                role="status"
                className="rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed"
              >
                {register
                  ? "Yangi firmalar uchun ro‘yxatdan o‘tish hali ochilmagan. Platforma ishga tayyorlanmoqda."
                  : "Email xizmati hali ulanmagan. Parolni tiklash uchun platforma operatoriga murojaat qiling."}
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  navigate(admin ? "/super-admin" : "/platforma/kirish")
                }
              >
                Kirishga qaytish
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <ErrorMessage message={error} />}
              {sent ? (
                <p
                  role="status"
                  className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800"
                >
                  Tasdiqlangan hisob mavjud bo‘lsa, parolni tiklash xati
                  yuborildi. Emailingizni tekshiring.
                </p>
              ) : (
                <>
                  {register && (
                    <>
                      <Field label="Ism va familiya">
                        <Input
                          name="name"
                          required
                          minLength={2}
                          maxLength={120}
                          autoComplete="name"
                        />
                      </Field>
                      <Field label="Firma nomi">
                        <Input
                          name="companyName"
                          required
                          minLength={2}
                          maxLength={160}
                          autoComplete="organization"
                        />
                      </Field>
                      <Field label="Firma kodi">
                        <Input
                          name="slug"
                          required
                          minLength={2}
                          maxLength={63}
                          pattern="[a-z][a-z0-9\-]{1,62}"
                          placeholder="masalan: baraka-savdo"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </Field>
                      <Field label="Telefon">
                        <Input
                          name="phone"
                          type="tel"
                          required
                          minLength={7}
                          maxLength={32}
                          autoComplete="tel"
                          placeholder="+998"
                        />
                      </Field>
                    </>
                  )}
                  <Field label="Email">
                    <Input
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                    />
                  </Field>
                  {!forgot && (
                    <Field
                      label={register ? "Parol (kamida 8 belgi)" : "Parol"}
                    >
                      <Input
                        name="password"
                        type="password"
                        required
                        minLength={register ? 8 : 1}
                        maxLength={72}
                        autoComplete={
                          register ? "new-password" : "current-password"
                        }
                      />
                    </Field>
                  )}
                  <Button className="w-full" disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4" />
                    )}
                    {forgot
                      ? "Tiklash xatini yuborish"
                      : register
                        ? "Hisob yaratish"
                        : "Kirish"}
                  </Button>
                </>
              )}
              <div className="flex flex-wrap justify-between gap-2 pt-2 text-sm">
                {!admin &&
                  (register ||
                    forgot ||
                    capabilities.data?.registrationEnabled === true) && (
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() =>
                        navigate(
                          register || forgot
                            ? "/platforma/kirish"
                            : "/platforma/royxat"
                        )
                      }
                    >
                      {register || forgot
                        ? "Kirishga qaytish"
                        : "Yangi firma ochish"}
                    </button>
                  )}
                {!register &&
                  !forgot &&
                  capabilities.data?.emailEnabled === true && (
                    <button
                      type="button"
                      className="text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => navigate("/platforma/parol-tiklash")}
                    >
                      Parolni unutdingizmi?
                    </button>
                  )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TokenPage({
  kind,
  onDone,
}: {
  kind: "verify" | "reset";
  onDone: () => void;
}) {
  const [, navigate] = useLocation();
  const [token] = useState(() => window.location.hash.slice(1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          {kind === "verify" ? "Emailni tasdiqlash" : "Yangi parol"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {kind === "verify"
            ? "Hisobingizni tasdiqlash uchun quyidagi tugmani bosing."
            : "Kamida 8 belgidan iborat yangi parol yarating."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorMessage message={error} />}
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-emerald-700">
              {kind === "verify"
                ? "Email tasdiqlandi. Firmangiz tayyorlash navbatiga qo‘shildi."
                : "Parol yangilandi. Yangi parol bilan kiring."}
            </p>
            <Button onClick={() => navigate("/platforma")}>
              Kabinetga o‘tish
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async event => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const values = new FormData(event.currentTarget);
              try {
                await api(`/${kind}`, {
                  token,
                  ...(kind === "reset"
                    ? { password: values.get("password") }
                    : {}),
                });
                setDone(true);
                onDone();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {kind === "reset" && (
              <Field label="Yangi parol">
                <Input
                  type="password"
                  name="password"
                  minLength={8}
                  maxLength={72}
                  required
                  autoComplete="new-password"
                />
              </Field>
            )}
            <Button disabled={busy || !token}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {kind === "verify" ? "Emailni tasdiqlash" : "Parolni saqlash"}
            </Button>
            {!token && (
              <ErrorMessage message="Emaildagi to‘liq havolani oching. Havola shu oynada ishlatilgan bo‘lsa, kabinetga qayting." />
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
