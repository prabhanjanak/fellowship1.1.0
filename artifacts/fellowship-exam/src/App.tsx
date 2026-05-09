import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "./components/ui/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import AppSidebar from "./components/AppSidebar";
import { PageTransition } from "./components/PageTransition";
import LoginPage from "./pages/LoginPage";
import ForcePasswordResetPage from "./pages/ForcePasswordResetPage";
import DashboardPage from "./pages/DashboardPage";
import CandidatesPage from "./pages/CandidatesPage";
import ExamsPage from "./pages/ExamsPage";
import ProgramsPage from "./pages/ProgramsPage";
import UsersPage from "./pages/UsersPage";
import InterviewsPage from "./pages/InterviewsPage";
import RankingsPage from "./pages/RankingsPage";
import AllocationsPage from "./pages/AllocationsPage";
import ProfilePage from "./pages/ProfilePage";
import ResultsPage from "./pages/ResultsPage";
import ApplicationFormsPage from "./pages/ApplicationFormsPage";
import UnitsPage from "./pages/UnitsPage";
import SeatMatrixPage from "./pages/SeatMatrixPage";
import PaymentsPage from "./pages/PaymentsPage";
import BatchesPage from "./pages/BatchesPage";
import ReportsPage from "./pages/ReportsPage";
import TemplatesPage from "./pages/TemplatesPage";
import ApplyPage from "./pages/ApplyPage";
import QueueDisplayPage from "./pages/QueueDisplayPage";
import DisplayPage from "./pages/DisplayPage";
import NotFound from "./pages/not-found";
import { Loader2 } from "lucide-react";
import EmailSettingsPage from "./pages/EmailSettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (user.forcePasswordReset) return <ForcePasswordResetPage />;

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <PageTransition>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/programs" component={ProgramsPage} />
            <Route path="/users" component={UsersPage} />
            <Route path="/candidates" component={CandidatesPage} />
            <Route path="/exams" component={ExamsPage} />
            <Route path="/interviews" component={InterviewsPage} />
            <Route path="/rankings" component={RankingsPage} />
            <Route path="/allocations" component={AllocationsPage} />
            <Route path="/application-forms" component={ApplicationFormsPage} />
            <Route path="/units" component={UnitsPage} />
            <Route path="/seat-matrix" component={SeatMatrixPage} />
            <Route path="/payments" component={PaymentsPage} />
            <Route path="/batches" component={BatchesPage} />
            <Route path="/reports" component={ReportsPage} />
            <Route path="/templates" component={TemplatesPage} />
            <Route path="/email-settings" component={EmailSettingsPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/results" component={ResultsPage} />
            <Route path="/display" component={DisplayPage} />
            <Route path="/tv" component={QueueDisplayPage} />
            <Route component={NotFound} />
          </Switch>
        </PageTransition>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <WouterRouter>
            <Switch>
              {/* Public Routes - NO Sidebar, NO Auth needed */}
              <Route path="/apply/:token">
                {(params) => <ApplyPage token={params.token} />}
              </Route>
              <Route path="/tv" component={QueueDisplayPage} />
              
              {/* Auth Routes */}
              <Route>
                <AuthProvider>
                  <AppRouter />
                  <Toaster />
                </AuthProvider>
              </Route>
            </Switch>
          </WouterRouter>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
