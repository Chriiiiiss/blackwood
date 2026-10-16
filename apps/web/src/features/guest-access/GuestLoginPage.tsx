import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import styles from "./login.module.scss";
import { guestAccessKey } from "./queries";
import {
  GuestAccessError,
  loginGuestAccess,
  readGuestAccess,
} from "./requests";

export function GuestLoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const access = useQuery({
    queryKey: [...guestAccessKey, "login"],
    queryFn: ({ signal }) => readGuestAccess(signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: loginGuestAccess,
    retry: false,
    gcTime: 0,
  });
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const profile = access.data?.profile;

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Hôtel Blackwood</p>
      <h1>Retrouve ta clé.</h1>
      <p>
        Déjà inscrit ? Le code personnel transmis par Chris te permet de
        retrouver ton profil et ta réponse.
      </p>
      {access.isPending ? (
        <p role="status">Je retrouve ton accès…</p>
      ) : access.isError ? (
        <div role="alert">
          <p>Impossible de vérifier ton accès. Réessaie.</p>
          <button type="button" onClick={() => void access.refetch()}>
            Réessayer
          </button>
        </div>
      ) : profile ? (
        <div>
          <p>
            Tu es déjà reconnu, {profile.firstName}. Ton accès est conservé sur
            ce navigateur.
          </p>
          <Link to={access.data.hubEnabled ? "/" : "/invitation"}>
            Continuer
          </Link>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            setMessage("");
            const submitted = code;
            setCode("");
            try {
              const result = await mutation.mutateAsync(submitted);
              if (!mounted.current) return;
              await client.cancelQueries({ queryKey: guestAccessKey });
              client.setQueryData(guestAccessKey, result);
              client.setQueryData([...guestAccessKey, "login"], result);
              await navigate({
                to: result.hubEnabled ? "/" : "/invitation",
                replace: true,
              });
            } catch (error) {
              if (!mounted.current) return;
              setMessage(
                error instanceof GuestAccessError && error.status === 401
                  ? "Ce code est incorrect ou désactivé. Vérifie-le ou demande un nouveau code à Chris."
                  : error instanceof GuestAccessError && error.status === 429
                    ? `Trop de tentatives. Réessaie dans ${Math.max(1, Math.ceil(error.retryAfter / 60))} minute(s).`
                    : error instanceof GuestAccessError && error.status === 409
                      ? "Ce navigateur est déjà associé à un autre profil. Utilise un autre navigateur pour ce code."
                      : "La connexion est indisponible. Réessaie dans un instant.",
              );
            } finally {
              mutation.reset();
              submitting.current = false;
            }
          }}
        >
          <label htmlFor="guest-code">Ton code personnel</label>
          <input
            id="guest-code"
            name="code"
            type="password"
            autoComplete="current-password"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={128}
            value={code}
            disabled={mutation.isPending}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby={message ? "code-hint code-error" : "code-hint"}
          />
          <p id="code-hint" className={styles.hint}>
            Tu peux coller le code avec ses tirets. Si tu ne l’as pas,
            demande-le à Chris.
          </p>
          {message && (
            <p id="code-error" role="alert">
              {message}
            </p>
          )}
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Connexion…" : "Retrouver mon profil"}
          </button>
        </form>
      )}
      <Link to="/invitation" className={styles.back}>
        ← Retour à l’invitation
      </Link>
    </main>
  );
}
