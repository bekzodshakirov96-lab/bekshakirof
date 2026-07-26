import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Agents from "./pages/Agents";
import AktSverka from "./pages/AktSverka";
import Cash from "./pages/Cash";
import Clients from "./pages/Clients";
import Containers from "./pages/Containers";
import Dashboard from "./pages/Dashboard";
import Debts from "./pages/Debts";
import ImportExcel from "./pages/ImportExcel";
import FastKeg from "./pages/FastKeg";
import Products from "./pages/Products";
import KassaReports from "./pages/KassaReports";
import SalesReport from "./pages/SalesReport";
import Stock from "./pages/Stock";
import StockReport from "./pages/StockReport";
import Transactions from "./pages/Transactions";
import Users from "./pages/Users";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Dashboard} />
      <Route path={"/qarzdorlik"} component={Debts} />
      <Route path={"/agentlar"} component={Agents} />
      <Route path={"/mijozlar"} component={Clients} />
      <Route path={"/akt-sverka"} component={AktSverka} />
      <Route path={"/savdo"} component={Transactions} />
      <Route path={"/sotuv-hisoboti"} component={SalesReport} />
      <Route path={"/tezkor-keg"} component={FastKeg} />
      <Route path={"/mahsulotlar"} component={Products} />
      <Route path={"/sklad"} component={Stock} />
      <Route path={"/sklad-hisoboti"} component={StockReport} />
      <Route path={"/kassa"} component={Cash} />
      <Route path={"/kassa-hisoboti"} component={KassaReports} />
      <Route path={"/tara"} component={Containers} />
      <Route path={"/import"} component={ImportExcel} />
      <Route path={"/foydalanuvchilar"} component={Users} />
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
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        switchable
      >
        <TooltipProvider>
          <Toaster />
          <DashboardLayout>
            <Router />
          </DashboardLayout>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
