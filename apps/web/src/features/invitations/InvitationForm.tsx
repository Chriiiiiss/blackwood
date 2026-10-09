import { useEffect, useRef } from "react";
import styles from "./invitations.module.scss";
import {
  characterCount,
  type FieldErrors,
  type InvitationFields,
} from "./model";

interface InvitationFormProps {
  fields: InvitationFields;
  errors: FieldErrors;
  message: string;
  pending: boolean;
  isEditing: boolean;
  focusField: keyof InvitationFields | null;
  onFieldChange: <K extends keyof InvitationFields>(
    name: K,
    value: InvitationFields[K],
  ) => void;
  onSubmit: () => void;
}

export function InvitationForm({
  fields,
  errors,
  message,
  pending,
  isEditing,
  focusField,
  onFieldChange,
  onSubmit,
}: InvitationFormProps) {
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isEditing)
      form.current?.querySelector<HTMLInputElement>("#first-name")?.focus();
  }, [isEditing]);

  useEffect(() => {
    if (focusField && errors[focusField]) {
      form.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          `[name="${focusField}"]`,
        )
        ?.focus();
    }
  }, [errors, focusField]);

  return (
    <>
      <p className={styles.registerAside}>la réception, c’est moi.</p>
      <h2 id="register-title" className="visually-hidden">
        Ta réponse
      </h2>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        noValidate
        aria-busy={pending}
      >
        <fieldset className={styles.formFields} disabled={pending}>
          <legend className="visually-hidden">Ta réponse à l’invitation</legend>
          <div className={styles.field}>
            <label htmlFor="first-name">Ton prénom</label>
            <input
              id="first-name"
              name="firstName"
              autoComplete="given-name"
              required
              value={fields.firstName}
              onChange={(event) =>
                onFieldChange("firstName", event.target.value)
              }
              aria-invalid={Boolean(errors.firstName)}
              aria-describedby={`first-name-hint${errors.firstName ? " first-name-error" : ""}`}
              placeholder="Ton petit nom"
            />
            <p id="first-name-hint" className="visually-hidden">
              50 caractères maximum.
            </p>
            {errors.firstName && (
              <p id="first-name-error" className={styles.fieldError}>
                {errors.firstName}
              </p>
            )}
          </div>
          <fieldset
            className={styles.choiceField}
            aria-describedby={
              errors.attendance ? "attendance-error" : undefined
            }
          >
            <legend>Tu viens ?</legend>
            <div className={styles.choices}>
              {(
                [
                  ["yes", "Oui"],
                  ["no", "Non"],
                  ["to_confirm", "À confirmer"],
                ] as const
              ).map(([value, label]) => (
                <label className={styles.choice} key={value}>
                  <input
                    type="radio"
                    name="attendance"
                    value={value}
                    required
                    checked={fields.attendance === value}
                    onChange={() => onFieldChange("attendance", value)}
                    aria-invalid={Boolean(errors.attendance)}
                    aria-describedby={
                      errors.attendance ? "attendance-error" : undefined
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {errors.attendance && (
              <p id="attendance-error" className={styles.fieldError}>
                {errors.attendance}
              </p>
            )}
          </fieldset>
          {fields.attendance && fields.attendance !== "no" && (
            <fieldset
              className={styles.choiceField}
              aria-describedby={`plus-one-hint${errors.plusOne ? " plus-one-error" : ""}`}
            >
              <legend>Solo bolo ?</legend>
              <div className={styles.choices}>
                {(["no", "yes"] as const).map((value) => (
                  <label className={styles.choice} key={value}>
                    <input
                      type="radio"
                      name="plusOne"
                      value={value}
                      required
                      checked={fields.plusOne === value}
                      onChange={() => onFieldChange("plusOne", value)}
                      aria-invalid={Boolean(errors.plusOne)}
                      aria-describedby={`plus-one-hint${errors.plusOne ? " plus-one-error" : ""}`}
                    />
                    <span>
                      {value === "yes" ? "Je viens à deux" : "Oui, solo"}
                    </span>
                  </label>
                ))}
              </div>
              <p id="plus-one-hint" className={styles.fieldHint}>
                Tu peux ramener une personne.
              </p>
              {errors.plusOne && (
                <p id="plus-one-error" className={styles.fieldError}>
                  {errors.plusOne}
                </p>
              )}
            </fieldset>
          )}
          <div className={styles.field}>
            <label htmlFor="ideas">
              Une idée pour la soirée ?{" "}
              <span className={styles.fieldDetail} aria-hidden="true">
                si t’as envie
              </span>
            </label>
            <textarea
              id="ideas"
              name="ideas"
              rows={2}
              value={fields.ideas}
              onChange={(event) => onFieldChange("ideas", event.target.value)}
              aria-invalid={Boolean(errors.ideas)}
              aria-describedby={`ideas-hint${errors.ideas ? " ideas-error" : ""}`}
              placeholder="Je t’écoute."
            />
            <p
              id="ideas-hint"
              className={`${styles.fieldHint} ${styles.ideasHint}${fields.ideas ? "" : " visually-hidden"}`}
            >
              <span>
                {characterCount(fields.ideas).toLocaleString("fr-FR")} / 1 000
              </span>
            </p>
            {errors.ideas && (
              <p id="ideas-error" className={styles.fieldError}>
                {errors.ideas}
              </p>
            )}
          </div>
          {message && (
            <p className={styles.formMessage} role="alert">
              {message}
            </p>
          )}
          <button className={styles.primaryButton} type="submit">
            {pending ? "Enregistrement…" : "Envoyer à Chris"}
          </button>
        </fieldset>
        <p className={styles.registerNote}>Tu pourras changer d’avis ici.</p>
      </form>
    </>
  );
}
