import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/language";
import { Route, Switch, useLocation } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppUpdateNotice } from "./components/AppUpdateNotice";

const NotFound = lazy(() => import("./pages/NotFound"));
const Platform = lazy(() => import("./pages/Platform"));
const Agents = lazy(() => import("./pages/Agents"));
const AktSverka = lazy(() => import("./pages/AktSverka"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Cash = lazy(() => import("./pages/Cash"));
const Clients = lazy(() => import("./pages/Clients"));
const Containers = lazy(() => import("./pages/Containers"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Debts = lazy(() => import("./pages/Debts"));
const Employees = lazy(() => import("./pages/Employees"));
const Factory = lazy(() => import("./pages/Factory"));
const ImportExcel = lazy(() => import("./pages/ImportExcel"));
const FastKeg = lazy(() => import("./pages/FastKeg"));
const Products = lazy(() => import("./pages/Products"));
const KassaReports = lazy(() => import("./pages/KassaReports"));
const SalesReport = lazy(() => import("./pages/SalesReport"));
const Stock = lazy(() => import("./pages/Stock"));
const StockReport = lazy(() => import("./pages/StockReport"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Users = lazy(() => import("./pages/Users"));
const CompanySettings = lazy(() => import("./pages/CompanySettings"));

function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground">
      <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      Sahifa yuklanmoqda…
    </div>
  );
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Dashboard} />
      <Route path={"/qarzdorlik"} component={Debts} />
      <Route path={"/agentlar"} component={Agents} />
      <Route path={"/xodimlar"} component={Employees} />
      <Route path={"/mijozlar"} component={Clients} />
      <Route path={"/akt-sverka"} component={AktSverka} />
      <Route path={"/savdo"} component={Transactions} />
      <Route path={"/sotuv-hisoboti"} component={SalesReport} />
      <Route path={"/tezkor-keg"} component={FastKeg} />
      <Route path={"/mahsulotlar"} component={Products} />
      <Route path={"/sklad"} component={Stock} />
      <Route path={"/sklad-hisoboti"} component={StockReport} />
      <Route path={"/zavod"} component={Factory} />
      <Route path={"/kassa"} component={Cash} />
      <Route path={"/kassa-hisoboti"} component={KassaReports} />
      <Route path={"/tara"} component={Containers} />
      <Route path={"/import"} component={ImportExcel} />
      <Route path={"/foydalanuvchilar"} component={Users} />
      <Route path={"/ozgarishlar-tarixi"} component={AuditLog} />
      <Route path={"/firma-sozlamalari"} component={CompanySettings} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  const [location] = useLocation();
  const platformPage = location === "/platforma" || location.startsWith("/platforma/") || location === "/super-admin" || location.startsWith("/super-admin/");
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        switchable
      >
        <LanguageProvider>
          <TooltipProvider>
            <Toaster />
            <AppUpdateNotice />
            <ErrorBoundary>
              {platformPage ? <Suspense fallback={<PageLoading />}><Platform /></Suspense> : <DashboardLayout>
                <Suspense fallback={<PageLoading />}><Router /></Suspense>
              </DashboardLayout>}
            </ErrorBoundary>
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
