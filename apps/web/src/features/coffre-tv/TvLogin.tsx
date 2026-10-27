import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CoffreRequestError } from "../coffre/requests";
import { loginTv } from "./requests";
import styles from "./tv.module.scss";
export function TvLogin({ onLogin }: { onLogin: () => Promise<unknown> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const guard = useRef(false);
  const mutation = useMutation({
    mutationFn: loginTv,
    retry: false,
    gcTime: 0,
  });
  return (
    <section className={styles.gate}>
      <p className={styles.eyebrow}>La télévision de la soirée</p>
      <h1>Quatre chiffres, puis place aux souvenirs.</h1>
      <p>
        Depuis Organisateur → Coffre, affiche un code TV et saisis-le ici. Cette
        télé restera connectée pendant 7 jours.
      </p>
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
              caught instanceof CoffreRequestError && caught.status === 401
                ? "Code incorrect, expiré ou épuisé. Génère un nouveau code TV."
                : caught instanceof CoffreRequestError && caught.status === 429
                  ? "Trop de tentatives. Génère un nouveau code TV."
                  : "La connexion est indisponible. Réessaie dans un instant.",
            );
          } finally {
            guard.current = false;
          }
        }}
      >
        <label htmlFor="tv-code">Code TV</label>
        <input
          id="tv-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          required
          minLength={4}
          maxLength={4}
          pattern="[0-9]{4}"
          value={code}
          disabled={mutation.isPending}
          onChange={(event) =>
            setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))
          }
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
