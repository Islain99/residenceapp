import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useAuth, useUser } from './auth/session';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { HandoverPage } from './pages/HandoverPage';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { NoteDetailPage } from './pages/NoteDetailPage';
import { ForgotPasswordPage, SetPasswordPage } from './pages/PasswordPages';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentsPage } from './pages/ResidentsPage';
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
        { path: 'residents', element: <ResidentsPage /> },
        { path: 'residents/:id', element: <ResidentPage /> },
        { element: <RequireResponsable />, children: [{ path: 'equipe', element: <TeamPage /> }] },
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
