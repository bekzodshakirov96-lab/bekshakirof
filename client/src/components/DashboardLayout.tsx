import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3,
  Beer,
  Boxes,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Factory,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Landmark,
  LockKeyhole,
  LogOut,
  PackageOpen,
  ReceiptText,
  ShieldCheck,
  UserCog,
  UsersRound,
  WalletCards,
  Warehouse,
} from "lucide-react";
import { useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

type AppRole = "admin" | "accountant" | "agent" | "sklad" | "user";

type MenuItem = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  path: string;
  /** Rollar ro'yxati — kim shu bo'limni ko'ra oladi. "admin" har doim qo'shilib turadi.
   * Berilmasa, standart holatda faqat rahbar va buxgalter uchun (biznes ma'lumotlari). */
  roles?: AppRole[];
};

const defaultRoles: AppRole[] = ["admin", "accountant"];

function canSeeMenuItem(item: MenuItem, role: AppRole | undefined) {
  if (!role) return false;
  if (role === "admin") return true;
  return (item.roles ?? defaultRoles).includes(role);
}

const menuGroups: Array<{ label: string; items: MenuItem[] }> = [
  {
    label: "Umumiy",
    items: [
      { icon: LayoutDashboard, label: "Boshqaruv paneli", path: "/" },
      { icon: CircleDollarSign, label: "Qarzdorlik hisoboti", path: "/qarzdorlik", roles: ["admin", "accountant", "agent"] },
    ],
  },
  {
    label: "Savdo va moliya",
    items: [
      { icon: Beer, label: "Tezkor KEG savdosi", path: "/tezkor-keg", roles: ["admin", "accountant", "agent"] },
      { icon: ReceiptText, label: "Yangi savdo", path: "/savdo", roles: ["admin", "accountant", "agent"] },
      { icon: BarChart3, label: "Sotuv bo‘yicha hisobot", path: "/sotuv-hisoboti" },
      { icon: WalletCards, label: "KASSA", path: "/kassa" },
      { icon: BarChart3, label: "Kassa hisobotlari", path: "/kassa-hisoboti" },
      { icon: PackageOpen, label: "Mahsulotlar", path: "/mahsulotlar", roles: ["admin", "accountant", "sklad"] },
      { icon: Warehouse, label: "Sklad", path: "/sklad", roles: ["admin", "accountant", "sklad"] },
      { icon: BarChart3, label: "Sklad hisoboti", path: "/sklad-hisoboti", roles: ["admin", "accountant", "sklad"] },
      { icon: Factory, label: "Zavod hisob-kitobi", path: "/zavod", roles: ["admin", "accountant", "sklad"] },
    ],
  },
  {
    label: "Hamkorlar",
    items: [
      { icon: UsersRound, label: "Agentlar", path: "/agentlar" },
      { icon: Building2, label: "Mijozlar", path: "/mijozlar", roles: ["admin", "accountant", "agent"] },
      { icon: FileText, label: "Akt sverka", path: "/akt-sverka", roles: ["admin", "accountant", "agent"] },
    ],
  },
  {
    label: "Nazorat",
    items: [
      { icon: Boxes, label: "Tara nazorati", path: "/tara" },
      { icon: FileSpreadsheet, label: "Excel import", path: "/import" },
      { icon: UserCog, label: "Foydalanuvchilar", path: "/foydalanuvchilar", roles: ["admin"] },
    ],
  },
];

function getInitials(name?: string | null) {
  if (!name) return "U";
  return name
    .split(" ")
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");
}

function LoginScreen() {
  const { login, loginPending, loginError, register, registerPending, registerError } = useAuth();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(loginForm);
    } catch {
      // error surfaced via loginError below
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await register(registerForm);
    } catch {
      // error surfaced via registerError below
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#edf3f8] px-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(32,116,162,0.14),transparent_31%),radial-gradient(circle_at_88%_78%,rgba(31,166,147,0.12),transparent_30%)]" />
      <div className="relative w-full max-w-md rounded-[28px] border border-white/80 bg-white/90 p-8 shadow-[0_24px_80px_rgba(19,50,77,0.16)] backdrop-blur-xl sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#176f9d] to-[#1ca58f] text-white shadow-lg shadow-cyan-950/15">
            <Landmark className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight text-slate-900">NOKDAUN mchj</p>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Moliyaviy boshqaruv</p>
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-[-0.03em] text-slate-950">Tizimga xush kelibsiz</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Savdo, qarzdorlik, kassa va mijozlar ma’lumotlarini yagona xavfsiz muhitda boshqaring.
        </p>
        <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-xs leading-5 text-slate-500">
              Faqat rahbar va tasdiqlangan buxgalter hisoblari tizimga to‘liq kira oladi. Birinchi ro‘yxatdan
              o‘tgan hisob avtomatik rahbar bo‘ladi.
            </p>
          </div>
        </div>

        <Tabs defaultValue="login" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Kirish</TabsTrigger>
            <TabsTrigger value="register">Ro‘yxatdan o‘tish</TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="mt-5">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Parol</Label>
                <Input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={loginForm.password}
                  onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>
              {loginError ? (
                <p className="text-sm font-medium text-red-600">{loginError.message}</p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={loginPending}
                className="h-12 w-full rounded-xl bg-gradient-to-r from-[#176f9d] to-[#168c86] font-semibold shadow-lg shadow-cyan-900/15 hover:brightness-105"
              >
                {loginPending ? "Kirilmoqda..." : "Kirish"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="register" className="mt-5">
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="register-name">Ism</Label>
                <Input
                  id="register-name"
                  required
                  autoComplete="name"
                  value={registerForm.name}
                  onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={registerForm.email}
                  onChange={e => setRegisterForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-password">Parol (kamida 8 belgi)</Label>
                <Input
                  id="register-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={registerForm.password}
                  onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>
              {registerError ? (
                <p className="text-sm font-medium text-red-600">{registerError.message}</p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={registerPending}
                className="h-12 w-full rounded-xl bg-gradient-to-r from-[#176f9d] to-[#168c86] font-semibold shadow-lg shadow-cyan-900/15 hover:brightness-105"
              >
                {registerPending ? "Yuborilmoqda..." : "Ro‘yxatdan o‘tish"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <p className="mt-5 text-center text-xs text-slate-400">Kirish orqali korxona ma’lumotlari maxfiyligi ta’minlanadi.</p>
      </div>
    </div>
  );
}

function AccessPending({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-lg rounded-3xl border bg-white p-8 text-center shadow-xl shadow-slate-200/60">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <LockKeyhole className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-slate-950">Kirish hali tasdiqlanmagan</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
          Bu hisob tizimga kirdi, ammo rahbar unga hali ruxsat rolini bermagan. Rahbar foydalanuvchilar bo‘limidan ruxsat berishi mumkin.
        </p>
        <Button onClick={onLogout} variant="outline" className="mt-7 rounded-xl">
          <LogOut className="mr-2 h-4 w-4" /> Boshqa hisob bilan kirish
        </Button>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { loading, user, logout } = useAuth();
  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <LoginScreen />;
  if (user.role !== "admin" && user.role !== "accountant" && user.role !== "agent" && user.role !== "sklad") {
    return <AccessPending onLogout={logout} />;
  }

  return (
    <SidebarProvider defaultOpen>
      <DashboardShell onLogout={logout}>{children}</DashboardShell>
    </SidebarProvider>
  );
}

function DashboardShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const visibleGroups = menuGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => canSeeMenuItem(item, user?.role as AppRole | undefined)),
    }))
    .filter(group => group.items.length > 0);
  const activeItem = visibleGroups.flatMap(group => group.items).find(item => item.path === location);
  const roleLabels: Record<AppRole, string> = {
    admin: "Rahbar",
    accountant: "Buxgalter",
    agent: "Agent",
    sklad: "Sklad xodimi",
    user: "Ruxsatsiz",
  };
  const roleLabel = roleLabels[(user?.role as AppRole | undefined) ?? "user"];

  return (
    <>
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="px-3 pb-3 pt-4">
          <div className="flex h-14 items-center gap-3 rounded-2xl bg-white/7 px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-950/30">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-[15px] font-bold tracking-tight text-white">NOKDAUN mchj</p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">Biznes boshqaruvi</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2 pb-3">
          {visibleGroups.map(group => (
            <SidebarGroup key={group.label} className="py-2">
              <SidebarGroupLabel className="px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 group-data-[collapsible=icon]:hidden">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {group.items.map(item => {
                    const isActive = location === item.path;
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          tooltip={item.label}
                          onClick={() => setLocation(item.path)}
                          className="relative h-10 rounded-xl px-3 text-[13px] font-medium text-slate-300 transition-all hover:bg-white/8 hover:text-white data-[active=true]:bg-gradient-to-r data-[active=true]:from-cyan-400/20 data-[active=true]:to-emerald-400/10 data-[active=true]:font-semibold data-[active=true]:text-cyan-100 data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1/2 data-[active=true]:before:h-5 data-[active=true]:before:w-[3px] data-[active=true]:before:-translate-y-1/2 data-[active=true]:before:rounded-r-full data-[active=true]:before:bg-cyan-300 data-[active=true]:before:content-['']"
                        >
                          <item.icon className={`h-[18px] w-[18px] ${isActive ? "text-cyan-300" : "text-slate-500"}`} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/5 p-2 text-left transition-colors hover:bg-white/10 group-data-[collapsible=icon]:justify-center">
                <Avatar className="h-9 w-9 shrink-0 border border-cyan-300/20">
                  <AvatarFallback className="bg-cyan-300/15 text-xs font-bold text-cyan-100">{getInitials(user?.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-xs font-semibold text-white">{user?.name || "Foydalanuvchi"}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">{roleLabel}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500 group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" className="w-52 rounded-xl p-1.5">
              <DropdownMenuItem onClick={onLogout} className="cursor-pointer rounded-lg text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Tizimdan chiqish
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white/85 px-4 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-400">Distribyutsiya boshqaruvi</p>
              <h1 className="text-sm font-bold text-slate-900 sm:text-base">{activeItem?.label ?? "Boshqaruv paneli"}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden rounded-lg border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 sm:inline-flex">
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" /> Tizim faol
            </Badge>
            <div className="hidden text-right md:block">
              <p className="text-xs font-semibold text-slate-800">{new Date().toLocaleDateString("en-GB").replaceAll("/", ".")}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{roleLabel} rejimi</p>
            </div>
          </div>
        </header>
        <main className="min-h-[calc(100vh-4rem)] p-4 md:p-6 xl:p-8">{children}</main>
      </SidebarInset>
    </>
  );
}
