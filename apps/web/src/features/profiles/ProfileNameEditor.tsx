import { useRef, useState } from "react";
import { toast } from "sonner";
import type { GuestProfile } from "../guest-access/requests";
import styles from "./profile.module.scss";
import { useProfileMutation } from "./queries";
import { patchProfile, profileError } from "./requests";

export function ProfileNameEditor({ profile }: { profile: GuestProfile }) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [error, setError] = useState("");
  const [hoverMuted, setHoverMuted] = useState(false);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const mutation = useProfileMutation(patchProfile);
  const changed = firstName !== profile.firstName;
  return (
    <form
      className={styles.nameForm}
      onSubmit={async (event) => {
        event.preventDefault();
        if (guard.current || !changed) return;
        const name = firstName.trim();
        if (!name || [...name].length > 50) {
          setError("Ton prénom doit contenir entre 1 et 50 caractères.");
          return;
        }
        guard.current = true;
        setError("");
        try {
          const saved = await mutation.mutateAsync(name);
          setFirstName(saved.firstName);
          toast.success("Ton prénom a été enregistré.", { id: "profile-name" });
        } catch (caught) {
          toast.error(profileError(caught), { id: "profile-name" });
        } finally {
          guard.current = false;
        }
      }}
    >
      <label className="visually-hidden" htmlFor="profile-name">
        Ton prénom
      </label>
      <div className={styles.nameField}>
        <input
          ref={input}
          id="profile-name"
          className={styles.nameInput}
          autoComplete="given-name"
          required
          value={firstName}
          disabled={mutation.isPending}
          aria-invalid={!!error}
          aria-describedby={error ? "profile-name-error" : "profile-name-hint"}
          onChange={(event) => {
            setFirstName(event.target.value);
            setError("");
          }}
        />
        <button
          className={styles.nameAction}
          type={changed ? "submit" : "button"}
          data-mode={mutation.isPending ? "saving" : changed ? "save" : "edit"}
          data-hover-muted={hoverMuted}
          aria-label={
            mutation.isPending
              ? "Enregistrement…"
              : changed
                ? "Enregistrer mon prénom"
                : "Modifier mon prénom"
          }
          aria-busy={mutation.isPending}
          disabled={mutation.isPending}
          onPointerDown={() => setHoverMuted(true)}
          onPointerLeave={() => setHoverMuted(false)}
          onClick={() => {
            if (!changed) {
              input.current?.focus();
              input.current?.select();
            }
          }}
        >
          <span className={styles.actionIcons} aria-hidden="true">
            <svg
              className={`${styles.actionIcon} ${styles.pencilIcon}`}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                d="m15 5 4 4M4 20l4-1L20 7l-4-4L4 15z"
                strokeLinejoin="round"
              />
            </svg>
            <svg
              className={`${styles.actionIcon} ${styles.checkIcon}`}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                d="m5 12 4 4L19 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={`${styles.actionIcon} ${styles.spinnerIcon}`}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8" opacity=".25" />
                <path d="M12 4a8 8 0 0 1 8 8" strokeLinecap="round" />
              </svg>
            </span>
          </span>
        </button>
      </div>
      <p id="profile-name-hint" className="visually-hidden">
        Clique sur ton prénom pour le modifier, puis valide avec la coche ou la
        touche Entrée.
      </p>
      {error && (
        <p id="profile-name-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
