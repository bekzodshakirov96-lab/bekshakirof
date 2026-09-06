import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/lib/language";
import { useTheme } from "@/contexts/ThemeContext";
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
import {
  BarChart3,
  Beer,
  BriefcaseBusiness,
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  Factory,
  FileSpreadsheet,
  FileText,
  Languages,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Moon,
  PackageOpen,
  ReceiptText,
  ShieldCheck,
  Sun,
  UserCog,
  UsersRound,
  WalletCards,
  Warehouse,
} from "lucide-react";
import { useState, type ComponentType, type CSSProperties, type FormEvent, type ReactNode } from "react";
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
    ],
  },
  {
    label: "Ombor",
    items: [
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
      { icon: BriefcaseBusiness, label: "Xodimlar", path: "/xodimlar", roles: ["admin", "accountant"] },
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
      { icon: ShieldCheck, label: "O‘zgarishlar tarixi", path: "/ozgarishlar-tarixi", roles: ["admin"] },
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
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const needsSetup = trpc.auth.needsSetup.useQuery();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [setupForm, setSetupForm] = useState({ name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(loginForm);
    } catch {
      // error surfaced via loginError below
    }
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await register(setupForm);
    } catch {
      // error surfaced via registerError below
    }
  };

  const isFirstRun = needsSetup.data === true;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-20">
      {/* Ko'rinish tugmasi — kirishdan oldin ham ishlaydi */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Yorug‘ rejim" : "Qorong‘i rejim"}
        className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </button>
      <div className="relative w-full max-w-[460px] rounded-xl border border-border bg-card p-6 shadow-sm sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sidebar text-sidebar-foreground">
            <img src="/logo.svg" className="h-7 w-7 object-contain" alt="BiznesControl" />
          </div>
          <div className="min-w-0 flex-1">
            <p data-no-translit className="text-lg font-bold tracking-tight text-foreground">BiznesControl</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Moliyaviy boshqaruv</p>
          </div>
          {/* Yozuvni tanlash — kirishdan oldin ham ishlaydi, tanlov brauzerda saqlanadi */}
          <div data-no-translit className="flex shrink-0 rounded-lg border border-border bg-muted p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setLanguage("latin")}
              aria-pressed={language === "latin"}
              className={`rounded-md px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${language === "latin" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              O‘zb
            </button>
            <button
              type="button"
              onClick={() => setLanguage("cyrillic")}
              aria-pressed={language === "cyrillic"}
              className={`rounded-md px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${language === "cyrillic" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Ўзб
            </button>
          </div>
        </div>
        {needsSetup.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isFirstRun ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Boshlang‘ich sozlash</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Tizimda hali birorta ham hisob yo‘q. Shu yerda yaratiladigan birinchi hisob avtomatik rahbar
              huquqiga ega bo‘ladi.
            </p>
            <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Bu forma faqat bir marta, tizim birinchi ishga tushirilganda ko‘rinadi. Shu hisob yaratilgach,
                  keyingi barcha hisoblar Foydalanuvchilar bo‘limidan rahbar/buxgalter tomonidan yaratiladi.
                </p>
              </div>
            </div>

            <form onSubmit={handleSetup} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="setup-name">Ism</Label>
                <Input
                  id="setup-name"
                  required
                  autoFocus
                  autoComplete="name"
                  value={setupForm.name}
                  onChange={e => setSetupForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-email">Email</Label>
                <Input
                  id="setup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={setupForm.email}
                  onChange={e => setSetupForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-password">Parol (kamida 8 belgi)</Label>
                <div className="relative">
                  <Input
                    id="setup-password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="pr-10"
                    value={setupForm.password}
                    onChange={e => setSetupForm(f => ({ ...f, password: e.target.value }))}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setShowPassword(current => !current)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              {registerError ? (
                <p className="break-words text-sm font-medium text-destructive">{registerError.message}</p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={registerPending}
                className="h-11 w-full gap-2 rounded-lg font-semibold"
              >
                {registerPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {registerPending ? "Yaratilmoqda..." : "Rahbar hisobini yaratish"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tizimga xush kelibsiz</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Savdo, qarzdorlik, kassa va mijozlar ma’lumotlarini yagona xavfsiz muhitda boshqaring.
            </p>
            <div className="mt-6 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <p className="text-xs leading-5 text-muted-foreground">
                  Yangi hisob rahbar yoki buxgalter tomonidan Foydalanuvchilar bo‘limida yaratiladi — login va
                  parolni o‘zingiz ro‘yxatdan o‘tolmaysiz, ma’muriyatdan so‘rang.
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Parol</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="pr-10"
                    value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setShowPassword(current => !current)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              {loginError ? (
                <p className="break-words text-sm font-medium text-destructive">{loginError.message}</p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                disabled={loginPending}
                className="h-11 w-full gap-2 rounded-lg font-semibold"
              >
                {loginPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {loginPending ? "Kirilmoqda..." : "Kirish"}
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 border-t border-border pt-5 text-center text-xs leading-5 text-muted-foreground">Kirish orqali korxona ma’lumotlari maxfiyligi ta’minlanadi.</p>
      </div>
    </div>
  );
}

function AccessPending({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <LockKeyhole className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-foreground">Kirish hali tasdiqlanmagan</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Bu hisob tizimga kirdi, ammo rahbar unga hali ruxsat rolini bermagan. Rahbar foydalanuvchilar bo‘limidan ruxsat berishi mumkin.
        </p>
        <Button onClick={onLogout} variant="outline" className="mt-7 rounded-lg">
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
    <SidebarProvider defaultOpen style={{ "--sidebar-width": "17rem", "--sidebar-width-icon": "4rem" } as CSSProperties}>
      <DashboardShell onLogout={logout}>{children}</DashboardShell>
    </SidebarProvider>
  );
}

function DashboardShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const visibleGroups = menuGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => canSeeMenuItem(item, user?.role as AppRole | undefined)),
    }))
    .filter(group => group.items.length > 0);
  const activeItem = visibleGroups.flatMap(group => group.items).find(item => item.path === location);
  const activeGroup = visibleGroups.find(group => group.items.some(item => item.path === location));
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
      <Sidebar collapsible="icon" className="border-sidebar-border">
        <SidebarHeader className="h-16 justify-center border-b border-sidebar-border px-4 group-data-[collapsible=icon]:px-2">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-foreground">
              <img src="/logo.svg" className="h-6 w-6 object-contain" alt="BiznesControl" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p data-no-translit className="truncate text-[15px] font-bold tracking-tight text-sidebar-foreground">BiznesControl</p>
              <p className="mt-0.5 truncate text-[11px] text-sidebar-foreground/60">Savdo va moliya</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0 px-2 py-3 group-data-[collapsible=icon]:overflow-y-auto">
          {visibleGroups.map(group => (
            <SidebarGroup key={group.label} className="px-0 py-1">
              <SidebarGroupLabel className="h-7 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map(item => {
                    const isActive = location === item.path;
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          aria-current={isActive ? "page" : undefined}
                          tooltip={item.label}
                          onClick={() => setLocation(item.path)}
                          className="h-10 gap-2.5 rounded-md px-3 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground md:h-8 group-data-[collapsible=icon]:mx-auto"
                        >
                          <item.icon className={`h-4 w-4 ${isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60"}`} />
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
        <SidebarFooter className="gap-2 border-t border-sidebar-border p-3 group-data-[collapsible=icon]:px-2">
          {/* Ko‘rinish va yozuvni tez almashtirish — hisob kartochkasi ustida */}
          <div data-no-translit className="flex gap-2 group-data-[collapsible=icon]:flex-col">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Yorug‘ rejim" : "Qorong‘i rejim"}
              aria-label={theme === "dark" ? "Yorug‘ rejim" : "Qorong‘i rejim"}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-sidebar-border text-[11px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:min-h-8"
            >
              {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
              <span className="group-data-[collapsible=icon]:hidden">{theme === "dark" ? "Yorug‘" : "Qorong‘i"}</span>
            </button>
            <button
              type="button"
              onClick={() => setLanguage(language === "latin" ? "cyrillic" : "latin")}
              title={language === "latin" ? "Ўзбекчага o‘tish" : "Lotinchaga o‘tish"}
              aria-label={language === "latin" ? "Ўзбекчага o‘tish" : "Lotinchaga o‘tish"}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-sidebar-border text-[11px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:min-h-8"
            >
              <Languages className="h-4 w-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">{language === "latin" ? "O‘zb" : "Ўзб"}</span>
            </button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label={`${user?.name || "Foydalanuvchi"}: hisob menyusi`} className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center">
                <Avatar className="h-8 w-8 shrink-0 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-sidebar-accent text-xs font-semibold text-sidebar-foreground">{getInitials(user?.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-xs font-semibold text-sidebar-foreground">{user?.name || "Foydalanuvchi"}</p>
                  <p className="mt-0.5 truncate text-[11px] text-sidebar-foreground/60">{roleLabel}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" className="w-52 rounded-lg p-1.5">
              <DropdownMenuItem onClick={onLogout} className="cursor-pointer rounded-md text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Tizimdan chiqish
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger aria-label="Menyuni ochish yoki yopish" className="h-8 w-8 shrink-0 rounded-md text-muted-foreground" />
            <div className="hidden h-5 w-px bg-border sm:block" />
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">{activeGroup?.label ?? "Ish maydoni"}</span>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 lg:block" />
              <h1 className="truncate text-sm font-semibold text-foreground">{activeItem?.label ?? "Boshqaruv paneli"}</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="hidden items-center gap-2 text-xs tabular-nums text-muted-foreground md:flex">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>{new Date().toLocaleDateString("en-GB").replaceAll("/", ".")}</span>
            </div>
            <Badge variant="outline" className="hidden rounded-md border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              {roleLabel}
            </Badge>
          </div>
        </header>
        <div className="min-h-[calc(100vh-4rem)] min-w-0 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </>
  );
}
