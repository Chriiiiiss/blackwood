import { Link } from "@tanstack/react-router";
import type { GuestProfile } from "../guest-access/requests";
import styles from "./hub.module.scss";

const apps = [
  {
    id: "invitation",
    to: "/invitation",
    name: "Mon invitation",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
  },
  {
    id: "coffre",
    to: "/coffre",
    name: "Coffre",
    icon: (
      <>
        <path d="M4 11V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3M3 11h18v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        <path d="M8 4v7m8-7v7m-5 0h2v4h-2z" />
      </>
    ),
  },
  {
    id: "missions",
    to: "/missions",
    name: "Missions secrètes",
    icon: (
      <>
        <path d="M3 9c3-1 5 0 9 0s6-1 9 0v5c0 3-2 5-4 5s-4-3-5-3-3 3-5 3-4-2-4-5z" />
        <path d="m6 12 3 1m6 0 3-1M7 6l2-3m8 3-2-3" />
      </>
    ),
  },
  {
    id: "profile",
    to: "/profiles",
    name: "Mon profil",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
      </>
    ),
  },
] as const;

export function HubPage({ profile }: { profile: GuestProfile }) {
  return (
    <main className={`${styles.page} ${styles.launcher}`}>
      <p className={styles.eyebrow}>Halloween 2026</p>
      <h1>Bienvenue, {profile.firstName}.</h1>
      <nav className={styles.apps} aria-label="Applications de la soirée">
        {apps.map((app) => (
          <Link
            key={app.id}
            to={app.to}
            className={styles.app}
            data-app={app.id}
          >
            <span className={styles.appIcon}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {app.icon}
              </svg>
            </span>
            <span className={styles.appName}>{app.name}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
