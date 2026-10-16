import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import styles from "./organizer.module.scss";
import { organizerQueryKey } from "./queries";
import { login, OrganizerRequestError } from "./requests";

export function OrganizerLoginPage({
  reason,
}: {
  reason: "expired" | "signed-out" | undefined;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const mutation = useMutation({ mutationFn: login, retry: false, gcTime: 0 });
  useEffect(() => {
    mounted.current = true;
    void client
      .cancelQueries({ queryKey: organizerQueryKey })
      .then(() => client.removeQueries({ queryKey: organizerQueryKey }));
    return () => {
      mounted.current = false;
    };
  }, [client]);

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Espace organisateur</p>
      <h1>Bienvenue à la réception</h1>
      <p className={styles.muted}>
        Connecte-toi pour consulter les réponses aux invitations.
      </p>
      {reason === "expired" && (
        <p role="status">Ta session a expiré. Reconnecte-toi pour continuer.</p>
      )}
      <form
        className={styles.login}
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          setMessage("");
          const submitted = password;
          setPassword("");
          try {
            await mutation.mutateAsync(submitted);
            toast.success("Connexion réussie.", { id: "organizer-login" });
            if (mounted.current)
              void navigate({ to: "/organisateur/invitations", replace: true });
          } catch (error) {
            if (mounted.current)
              setMessage(
                error instanceof OrganizerRequestError && error.status === 401
                  ? "Ce mot de passe est incorrect."
                  : error instanceof OrganizerRequestError &&
                      error.status === 429
                    ? `Trop de tentatives. Réessaie dans ${Math.max(1, Math.ceil(error.retryAfter / 60))} minute(s).`
                    : "La connexion est indisponible. Réessaie dans un instant.",
              );
          } finally {
            mutation.reset();
            submitting.current = false;
            if (mounted.current) setBusy(false);
          }
        }}
      >
        <label htmlFor="organizer-password">Mot de passe</label>
        <input
          id="organizer-password"
          type="password"
          autoComplete="current-password"
          name="password"
          required
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={message ? "login-error" : undefined}
        />
        {message && (
          <p id="login-error" role="alert" className={styles.error}>
            {message}
          </p>
        )}
        <button className={styles.primary} type="submit" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
      <Link to="/" className={styles.back}>
        Retour à l’invitation
      </Link>
    </main>
  );
}
