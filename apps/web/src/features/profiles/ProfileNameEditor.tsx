import { useRef, useState } from "react";
import { toast } from "sonner";
import type { GuestProfile } from "../guest-access/requests";
import styles from "./profile.module.scss";
import { useProfileMutation } from "./queries";
import { patchProfile, profileError } from "./requests";

export function ProfileNameEditor({ profile }: { profile: GuestProfile }) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [error, setError] = useState("");
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
        {changed ? (
          <button
            className={styles.nameSave}
            type="submit"
            aria-label={
              mutation.isPending ? "Enregistrement…" : "Enregistrer mon prénom"
            }
            disabled={mutation.isPending}
          >
            <svg
              width="18"
              height="18"
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
          </button>
        ) : (
          <button
            className={styles.editButton}
            type="button"
            aria-label="Modifier mon prénom"
            onClick={() => {
              input.current?.focus();
              input.current?.select();
            }}
          >
            <svg
              width="16"
              height="16"
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
          </button>
        )}
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
