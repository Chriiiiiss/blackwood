import type { GuestProfile } from "../guest-access/requests";
import { AttendanceReaction } from "./AttendanceReaction";
import { InvitationConfirmation } from "./InvitationConfirmation";
import { InvitationForm } from "./InvitationForm";
import styles from "./invitations.module.scss";
import type { InvitationFields } from "./model";
import { useAttendanceReaction } from "./useAttendanceReaction";
import { useInvitationResponse } from "./useInvitationResponse";

export function InvitationResponse({
  profile,
}: {
  profile: GuestProfile | null;
}) {
  const response = useInvitationResponse(profile);
  const reaction = useAttendanceReaction();

  function updateField<K extends keyof InvitationFields>(
    name: K,
    value: InvitationFields[K],
  ) {
    if (name === "attendance")
      reaction.react(value as InvitationFields["attendance"]);
    response.updateField(name, value);
  }

  return (
    <section className={styles.register} aria-labelledby="register-title">
      {response.phase === "form" && reaction.reactionId > 0 && (
        <AttendanceReaction key={reaction.reactionId} />
      )}
      {response.phase === "loading" || response.phase === "load-error" ? (
        <div className={styles.registerState}>
          <h2 id="register-title">
            {response.phase === "loading"
              ? "Chargement de ta réponse"
              : "Chargement impossible"}
          </h2>
          {response.phase === "loading" ? (
            <p role="status">Chargement de ta réponse…</p>
          ) : (
            <>
              <p role="alert">{response.message}</p>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={response.retry}
              >
                Réessayer
              </button>
            </>
          )}
        </div>
      ) : response.phase === "success" ? (
        <InvitationConfirmation
          fields={response.fields}
          onEdit={response.edit}
        />
      ) : (
        <InvitationForm
          fields={response.fields}
          errors={response.errors}
          message={response.message}
          pending={response.pending}
          isEditing={response.isEditing}
          focusField={response.focusField}
          onFieldChange={updateField}
          onSubmit={() => {
            reaction.dismiss();
            void response.submit();
          }}
        />
      )}
    </section>
  );
}
