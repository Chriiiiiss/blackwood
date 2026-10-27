import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useOrganizerLayout } from "../OrganizerLayout";
import { issueTvCode, OrganizerRequestError } from "../requests";
import styles from "./organizer-coffre.module.scss";

export function TvPairing() {
  const { expire } = useOrganizerLayout();
  const guard = useRef(false);
  const mutation = useMutation({
    mutationFn: issueTvCode,
    retry: false,
    gcTime: 0,
  });
  const { reset, data } = mutation;
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(
      reset,
      Math.max(0, Date.parse(data.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [data, reset]);
  return (
    <section className={styles.panel} aria-labelledby="tv-pairing-title">
      <h3 id="tv-pairing-title">La soirée sur grand écran</h3>
      <p>
        Ouvre{" "}
        <a href="/coffre/tv" target="_blank" rel="noreferrer">
          /coffre/tv
        </a>{" "}
        sur la télé, puis saisis ce code. Aucun profil invité nécessaire.
      </p>
      {data && (
        <div className={styles.tvCode}>
          <output aria-label={`Code TV : ${data.code.split("").join(" ")}`}>
            <strong>{data.code}</strong>
          </output>
          <span>
            À usage unique · valable jusqu’à{" "}
            {new Intl.DateTimeFormat("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(data.expiresAt))}
          </span>
        </div>
      )}
      <button
        className={styles.secondary}
        type="button"
        disabled={mutation.isPending}
        onClick={async () => {
          if (guard.current) return;
          guard.current = true;
          reset();
          try {
            await mutation.mutateAsync();
          } catch (error) {
            if (error instanceof OrganizerRequestError && error.status === 401)
              expire();
            else
              toast.error(
                "Impossible de générer le code TV. Réessaie dans un instant.",
              );
          } finally {
            guard.current = false;
          }
        }}
      >
        {mutation.isPending
          ? "Création du code…"
          : data
            ? "Générer un autre code TV"
            : "Afficher un code TV"}
      </button>
    </section>
  );
}
