import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useAuth, useUser } from './auth/session';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AdminMessagesPage } from './pages/AdminMessagesPage';
import { AdminPage } from './pages/AdminPage';
import { AgendaPage } from './pages/AgendaPage';
import { AuditPage } from './pages/AuditPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { HandoverPage } from './pages/HandoverPage';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { MessagesPage } from './pages/MessagesPage';
import { NoteDetailPage } from './pages/NoteDetailPage';
import { ForgotPasswordPage, SetPasswordPage } from './pages/PasswordPages';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentStatsPage } from './pages/ResidentStatsPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { SchedulePage } from './pages/SchedulePage';
import { ShiftTypesPage } from './pages/ShiftTypesPage';
import { TeamPage } from './pages/TeamPage';

// Pages connectées : sans session, retour à la connexion (puis à la page demandée)
function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

// Pages réservées à la responsable (l'API refuse de toute façon les autres rôles)
function RequireResponsable() {
  return useUser().role === 'responsable' ? <Outlet /> : <NotFound />;
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="mb-4 text-lg">Page introuvable.</p>
      <Link to="/" className="text-primary underline">Retour à la relève</Link>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/connexion', element: <LoginPage /> },
  { path: '/mot-de-passe-oublie', element: <ForgotPasswordPage /> },
  { path: '/mot-de-passe', element: <SetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [{
      element: <Layout />,
      children: [
        { index: true, element: <HandoverPage /> },
        { path: 'journal', element: <JournalPage /> },
        { path: 'notes/:id', element: <NoteDetailPage /> },
        { path: 'suivis', element: <FollowUpsPage /> },
        { path: 'messages', element: <MessagesPage /> },
        { path: 'messages/:id', element: <MessagesPage /> },
        { path: 'agenda', element: <AgendaPage /> },
        { path: 'horaires', element: <SchedulePage /> },
        { path: 'residents', element: <ResidentsPage /> },
        { path: 'residents/:id', element: <ResidentPage /> },
        { path: 'residents/:id/statistiques', element: <ResidentStatsPage /> },
        {
          element: <RequireResponsable />,
          children: [
            {
              path: 'administration',
              element: <AdminPage />,
              children: [
                { index: true, element: <Navigate to="equipe" replace /> },
                { path: 'equipe', element: <TeamPage /> },
                { path: 'categories', element: <CategoriesPage /> },
                { path: 'quarts', element: <ShiftTypesPage /> },
                { path: 'messagerie', element: <AdminMessagesPage /> },
                { path: 'audit', element: <AuditPage /> },
              ],
            },
            { path: 'equipe', element: <Navigate to="/administration/equipe" replace /> },
          ],
        },
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
