import { useEffect, useRef } from "react";
import styles from "./invitations.module.scss";
import type { InvitationFields } from "./model";

interface InvitationConfirmationProps {
  fields: InvitationFields;
  wasUpdate: boolean;
  onEdit: () => void;
}

export function InvitationConfirmation({
  fields,
  wasUpdate,
  onEdit,
}: InvitationConfirmationProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  return (
    <div className={styles.registerState}>
      <span className={styles.confirmationSeal} aria-hidden="true">
        ✓
      </span>
      <h2 id="register-title" ref={heading} tabIndex={-1}>
        Merci pour ta réponse !
      </h2>
      <p role="status">
        {wasUpdate
          ? "Ta réponse a bien été mise à jour."
          : "Ta réponse a bien été enregistrée. Merci !"}
      </p>
      <div className={styles.responseSummary}>
        <p>
          <span>Prénom</span>
          <strong>{fields.firstName}</strong>
        </p>
        <p>
          <span>Présence</span>
          <strong>
            {fields.attendance === "yes"
              ? "Oui"
              : fields.attendance === "no"
                ? "Non"
                : "À confirmer"}
          </strong>
        </p>
        {fields.attendance !== "no" && (
          <p>
            <span>+1</span>
            <strong>{fields.plusOne === "yes" ? "Oui" : "Non"}</strong>
          </p>
        )}
      </div>
      <button className={styles.primaryButton} type="button" onClick={onEdit}>
        Modifier ma réponse
      </button>
      <p className={styles.registerNote}>
        Tu peux modifier ta réponse depuis ce navigateur.
      </p>
    </div>
  );
}
