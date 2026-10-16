import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { GuestProfile } from "../guest-access/requests";
import { AvatarEditor } from "./AvatarEditor";
import { CompanionPanel } from "./CompanionPanel";
import styles from "./profile.module.scss";
import { useProfileMutation } from "./queries";
import { patchProfile, profileError } from "./requests";

export function ProfilePage({ profile }: { profile: GuestProfile }) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const guard = useRef(false);
  const mutation = useProfileMutation(patchProfile);
  return (
    <main className={styles.page}>
      <Link to="/" className={styles.back}>
        ← Retour au hub
      </Link>
      <h1>Mon profil</h1>
      <p>Ton prénom et ta photo te suivent dans les applis de la soirée.</p>
      <section className={styles.section} aria-labelledby="name-heading">
        <h2 id="name-heading">Comment t’appelles-tu ?</h2>
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (guard.current) return;
            const name = firstName.trim();
            if (!name || [...name].length > 50) {
              setFailed(true);
              setFeedback("Ton prénom doit contenir entre 1 et 50 caractères.");
              return;
            }
            guard.current = true;
            setFeedback("");
            try {
              const saved = await mutation.mutateAsync(name);
              setFirstName(saved.firstName);
              setFailed(false);
              setFeedback("Ton prénom a été enregistré.");
            } catch (error) {
              setFailed(true);
              setFeedback(profileError(error));
            } finally {
              guard.current = false;
            }
          }}
        >
          <label htmlFor="profile-name">Ton prénom</label>
          <input
            id="profile-name"
            autoComplete="given-name"
            required
            value={firstName}
            disabled={mutation.isPending}
            onChange={(event) => setFirstName(event.target.value)}
          />
          <button disabled={mutation.isPending} type="submit">
            {mutation.isPending ? "Enregistrement…" : "Enregistrer mon prénom"}
          </button>
          {feedback && <p role={failed ? "alert" : "status"}>{feedback}</p>}
        </form>
      </section>
      <AvatarEditor profile={profile} />
      {profile.role === "main" && <CompanionPanel />}
      <p className={styles.hint}>
        Sur un autre navigateur, retrouve ce même profil avec le code personnel
        transmis par Chris.
      </p>
      <nav className={styles.actions} aria-label="Accès et invitation">
        <Link to="/login" className={styles.back}>
          Retrouver mon profil par code
        </Link>
        <Link to="/invitation" className={styles.back}>
          Mon invitation
        </Link>
      </nav>
    </main>
  );
}
