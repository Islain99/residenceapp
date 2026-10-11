// Appareil partagé : déconnexion automatique après 15 minutes sans activité
// (clic, toucher, clavier, défilement), avec un avertissement une minute avant.
//
// La dernière activité est partagée entre les onglets (localStorage) : un
// employé actif dans un onglet n'est pas déconnecté par un autre onglet resté
// ouvert en arrière-plan.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/session';
import { Button, Dialog } from './ui';

const IDLE_LIMIT_MS = 15 * 60_000;
const WARNING_MS = 60_000;
const CHECK_EVERY_MS = 5_000;
const STORAGE_KEY = 'journal:last-activity';
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

function readShared(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(at: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(at));
  } catch {
    // stockage indisponible (navigation privée) : suivi dans cet onglet seulement
  }
}

export function IdleLogout() {
  const { logout } = useAuth();
  const last = useRef(0);   // fixé au montage (touch)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let lastWrite = 0;
    const touch = () => {
      const now = Date.now();
      last.current = now;
      if (now - lastWrite > 10_000) {   // pas plus d'une écriture toutes les 10 s
        lastWrite = now;
        writeShared(now);
      }
    };
    touch();
    for (const event of EVENTS) window.addEventListener(event, touch, { passive: true });

    const timer = window.setInterval(() => {
      const idle = Date.now() - Math.max(last.current, readShared());
      if (idle >= IDLE_LIMIT_MS) {
        window.clearInterval(timer);
        void logout('Session fermée après 15 minutes sans activité (appareil partagé).');
      } else if (idle >= IDLE_LIMIT_MS - WARNING_MS) {
        setSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idle) / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, CHECK_EVERY_MS);

    return () => {
      window.clearInterval(timer);
      for (const event of EVENTS) window.removeEventListener(event, touch);
    };
  }, [logout]);

  const stay = () => {
    last.current = Date.now();
    writeShared(last.current);
    setSecondsLeft(null);
  };

  return (
    <Dialog open={secondsLeft !== null} onClose={stay} title="Toujours là ?">
      <p className="mb-5">
        Sans activité, la session se fermera dans <strong>{secondsLeft} s</strong> pour protéger
        les renseignements des résidents sur cet appareil partagé.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={() => void logout()}>Me déconnecter</Button>
        <Button variant="primary" onClick={stay}>Je suis là</Button>
      </div>
    </Dialog>
  );
}
