import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useAuth } from './auth/session';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { HandoverPage } from './pages/HandoverPage';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { NoteDetailPage } from './pages/NoteDetailPage';
import { ResidentPage } from './pages/ResidentPage';
import { ResidentsPage } from './pages/ResidentsPage';

// Pages connectées : sans session, retour à la connexion (puis à la page demandée)
function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
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
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
