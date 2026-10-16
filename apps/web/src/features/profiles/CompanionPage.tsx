import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { guestAccessKey, guestAccessOptions } from "../guest-access/queries";
import type { GuestAccess } from "../guest-access/requests";
import { AvatarEditor } from "./AvatarEditor";
import styles from "./profile.module.scss";
import { claimCompanion, profileError } from "./requests";

export function CompanionPage({ mainProfileId }: { mainProfileId: string }) {
  const hash = useLocation({ select: (location) => location.hash });
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
  const [firstName, setFirstName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [created, setCreated] = useState<GuestAccess | null>(null);
  const guard = useRef(false);
  const access = useQuery(guestAccessOptions());
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: claimCompanion,
    retry: false,
    gcTime: 0,
  });
  const validLink =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      mainProfileId,
    ) && /^[\w-]{43}$/.test(token);
  return (
    <main className={styles.page}>
      <h1>Ta place à l’hôtel.</h1>
      {created?.profile ? (
        <>
          <p>
            Ajoute une photo si tu en as envie, puis retrouve les applis de la
            soirée.
          </p>
          <AvatarEditor profile={access.data?.profile ?? created.profile} />
          <Link to="/profiles" className={styles.back}>
            Continuer vers mon profil
          </Link>
        </>
      ) : access.isPending ? (
        <p role="status">Je retrouve ton accès…</p>
      ) : access.isError ? (
        <>
          <p role="alert">
            Impossible de vérifier ton accès. Réessaie avant de créer un profil.
          </p>
          <button type="button" onClick={() => void access.refetch()}>
            Réessayer
          </button>
        </>
      ) : access.data.profile ? (
        <>
          <p>
            Tu es déjà reconnu, {access.data.profile.firstName}. Ton profil est
            conservé. Pour créer un autre profil, ouvre le lien sur le
            navigateur de ton +1 ou dans une fenêtre privée.
          </p>
          <Link
            to={access.data.hubEnabled ? "/profiles" : "/invitation"}
            className={styles.back}
          >
            Continuer avec mon profil
          </Link>
        </>
      ) : !validLink ? (
        <p role="alert">
          Ce lien est invalide. Demande un nouveau lien à la personne qui
          t’invite.
        </p>
      ) : !access.data.hubEnabled ? (
        <p role="status">
          Le hub est fermé pour le moment. Garde ce lien et réessaie à son
          ouverture.
        </p>
      ) : (
        <section className={styles.section}>
          <p>
            La personne qui t’invite t’a réservé sa place +1. Crée ton propre
            profil ; tu n’as pas de formulaire Invitations à remplir.
          </p>
          <form
            className={styles.form}
            onSubmit={async (event) => {
              event.preventDefault();
              if (guard.current) return;
              const name = firstName.trim();
              if (!name || [...name].length > 50) {
                setFeedback(
                  "Ton prénom doit contenir entre 1 et 50 caractères.",
                );
                return;
              }
              guard.current = true;
              setFeedback("");
              try {
                const result = await mutation.mutateAsync({
                  mainProfileId,
                  token,
                  firstName: name,
                });
                await client.cancelQueries({ queryKey: guestAccessKey });
                client.setQueryData(guestAccessKey, result);
                client.setQueryData([...guestAccessKey, "login"], result);
                setCreated(result);
                toast.success(
                  `Bienvenue, ${result.profile?.firstName}. Ton profil et ton accès personnel sont créés.`,
                  { id: "companion-claim" },
                );
                window.history.replaceState(
                  window.history.state,
                  "",
                  window.location.pathname,
                );
              } catch (error) {
                toast.error(profileError(error), { id: "companion-claim" });
              } finally {
                mutation.reset();
                guard.current = false;
              }
            }}
          >
            <label htmlFor="companion-name">Ton prénom</label>
            <input
              id="companion-name"
              autoComplete="given-name"
              required
              disabled={mutation.isPending}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
            <p className={styles.hint}>
              Tu pourras ajouter ta photo juste après la création de ton profil.
            </p>
            <button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Création…" : "Créer mon profil"}
            </button>
            {feedback && <p role="alert">{feedback}</p>}
          </form>
        </section>
      )}
      <p className={styles.hint}>
        Déjà inscrit sur un autre navigateur ? Utilise ton code personnel pour
        retrouver ton profil.
      </p>
      <Link to="/login" className={styles.back}>
        Retrouver mon profil par code
      </Link>
    </main>
  );
}
