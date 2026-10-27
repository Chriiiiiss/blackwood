import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { GuestAccessError, loginGuestAccess } from "../guest-access/requests";
import styles from "./tv.module.scss";
export function TvLogin({ onLogin }: { onLogin: () => Promise<unknown> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const guard = useRef(false);
  const mutation = useMutation({
    mutationFn: loginGuestAccess,
    retry: false,
    gcTime: 0,
  });
  return (
    <section className={styles.gate}>
      <p className={styles.eyebrow}>La télévision de la soirée</p>
      <h1>Une clé, puis place aux souvenirs.</h1>
      <p>Saisis ton code invité. L’accès restera mémorisé sur ce navigateur.</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (guard.current) return;
          guard.current = true;
          setError("");
          const value = code;
          setCode("");
          try {
            await mutation.mutateAsync(value);
            await onLogin();
          } catch (caught) {
            setError(
              caught instanceof GuestAccessError && caught.status === 401
                ? "Ce code est incorrect ou désactivé."
                : caught instanceof GuestAccessError && caught.status === 429
                  ? "Trop de tentatives. Réessaie dans quelques minutes."
                  : "La connexion est indisponible. Réessaie dans un instant.",
            );
          } finally {
            guard.current = false;
          }
        }}
      >
        <label htmlFor="tv-code">Ton code personnel</label>
        <input
          id="tv-code"
          type="password"
          autoComplete="current-password"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={128}
          value={code}
          disabled={mutation.isPending}
          onChange={(event) => setCode(event.target.value)}
          aria-describedby={error ? "tv-login-error" : undefined}
        />
        {error && (
          <p id="tv-login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Connexion…" : "Entrer dans la projection"}
        </button>
      </form>
    </section>
  );
}
