import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useAuth, useUser } from './auth/session';
import { Layout } from './components/Layout';
import { PlatformLayout } from './components/PlatformLayout';
import { Loading } from './components/ui';
import { AdminMessagesPage } from './pages/AdminMessagesPage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage } from './pages/AccountPage';
import { AgendaPage } from './pages/AgendaPage';
import { AssistancePage } from './pages/AssistancePage';
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
import { PlatformAdminsPage } from './pages/platform/PlatformAdminsPage';
import { PlatformAuditPage } from './pages/platform/PlatformAuditPage';
import { PlatformHomePage } from './pages/platform/PlatformHomePage';
import { PlatformResidencePage } from './pages/platform/PlatformResidencePage';
import { PlatformSecurityPage } from './pages/platform/PlatformSecurityPage';

// Pages connectées : sans session, retour à la connexion (puis à la page demandée)
function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

// Pages d'une résidence : l'admin plateforme n'y entre qu'en accès d'assistance
// (il y apparaît alors comme « responsable », en lecture seule)
function RequireResidence() {
  return useUser().role === 'admin' ? <Navigate to="/plateforme" replace /> : <Outlet />;
}

// Administration de la plateforme (hors accès d'assistance)
function RequireAdmin() {
  return useUser().role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}

// Pages réservées à la responsable (l'API refuse de toute façon les autres rôles)
function RequireResponsable() {
  return useUser().role === 'responsable' ? <Outlet /> : <NotFound />;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center">
      <p className="mb-4 text-lg">{t('common.pageNotFound')}</p>
      <Link to="/" className="text-primary underline">{t('common.backToHandover')}</Link>
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
      element: <RequireAdmin />,
      children: [{
        path: 'plateforme',
        element: <PlatformLayout />,
        children: [
          { index: true, element: <PlatformHomePage /> },
          { path: 'residences/:id', element: <PlatformResidencePage /> },
          { path: 'securite', element: <PlatformSecurityPage /> },
          { path: 'journal', element: <PlatformAuditPage /> },
          { path: 'administrateurs', element: <PlatformAdminsPage /> },
          { path: 'compte', element: <AccountPage /> },
          { path: '*', element: <NotFound /> },
        ],
      }],
    }, {
      element: <RequireResidence />,
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
          { path: 'compte', element: <AccountPage /> },
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
                  { path: 'assistance', element: <AssistancePage /> },
                  { path: 'audit', element: <AuditPage /> },
                ],
              },
              { path: 'equipe', element: <Navigate to="/administration/equipe" replace /> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      }],
    }],
  },
]);

// Changement de langue : toutes les pages sont redessinées dans la nouvelle
// langue (dates comprises) ; l'adresse, la session et les données restent
export default function App() {
  const { t, i18n } = useTranslation();
  // Titre de l'onglet dans la langue choisie
  useEffect(() => { document.title = t('common.appName'); }, [t]);
  return <RouterProvider key={i18n.language} router={router} />;
}
