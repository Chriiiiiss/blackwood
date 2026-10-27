import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import styles from "./coffre-name-editor.module.scss";

export function CoffreNameEditor({
  id,
  name,
  editable,
  busy,
  onSave,
}: {
  id: number;
  name: string | null;
  editable: boolean;
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  function close() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  return editing ? (
    <form
      className={styles.editor}
      aria-label="Renommer le Coffre"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = draft.trim();
        if (!value || [...value].length > 80) {
          toast.error("Choisis un nom de 1 à 80 caractères.");
          return;
        }
        if (await onSave(value)) close();
      }}
    >
      <h2 id="organizer-coffre-title" className="visually-hidden">
        Nom du Coffre
      </h2>
      <input
        ref={input}
        aria-label="Nom du Coffre"
        type="text"
        autoComplete="off"
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            close();
          }
        }}
      />
      <button type="submit" aria-label="Enregistrer le nom" disabled={busy}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12 4 4L19 6" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Annuler le changement de nom"
        disabled={busy}
        onClick={close}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </form>
  ) : (
    <div className={styles.title}>
      <h2 id="organizer-coffre-title">
        {name ?? `Le Coffre${id > 1 ? ` ${id}` : ""}.`}
      </h2>
      {editable && (
        <button
          ref={editButton}
          type="button"
          aria-label="Renommer le Coffre"
          disabled={busy}
          onClick={() => {
            setDraft(name ?? `Coffre ${id}`);
            setEditing(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z" />
          </svg>
        </button>
      )}
    </div>
  );
}
