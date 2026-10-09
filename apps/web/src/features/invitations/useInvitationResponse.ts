import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  emptyFields,
  type FieldErrors,
  type InvitationFields,
  toFields,
  toInput,
  validateFields,
} from "./model";
import {
  invitationResponseKey,
  invitationResponseOptions,
  saveInvitationOptions,
} from "./queries";
import { ResponseValidationError } from "./requests";
import {
  ensureResponseId,
  readResponseId,
  StorageUnavailableError,
} from "./response-storage";

function readSession() {
  try {
    return { id: readResponseId(), error: null };
  } catch (error) {
    return { id: null, error };
  }
}

export function useInvitationResponse() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(readSession);
  const [draft, setDraft] = useState<InvitationFields | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [wasUpdate, setWasUpdate] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [focusField, setFocusField] = useState<keyof InvitationFields | null>(
    null,
  );
  const submitting = useRef(false);
  const saveController = useRef<AbortController | null>(null);

  const restore = useQuery({
    ...invitationResponseOptions(session.id),
    enabled: session.error === null,
  });
  const save = useMutation({
    ...saveInvitationOptions,
    onSuccess: (response) => {
      queryClient.setQueryData(invitationResponseKey(response.id), response);
    },
  });

  useEffect(() => () => saveController.current?.abort(), []);

  const fields = draft ?? (restore.data ? toFields(restore.data) : emptyFields);
  const loadError = session.error ?? restore.error;
  const phase =
    session.error !== null
      ? "load-error"
      : restore.isFetching || restore.isPending
        ? "loading"
        : restore.isError
          ? "load-error"
          : isEditing || !restore.data
            ? "form"
            : "success";

  function updateField<K extends keyof InvitationFields>(
    name: K,
    value: InvitationFields[K],
  ) {
    setFocusField(null);
    setDraft((current) => ({
      ...(current ?? fields),
      [name]: value,
      ...(name === "attendance" && value === "no" ? { plusOne: "" } : {}),
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next[name];
      if (name === "attendance" && value === "no") delete next.plusOne;
      return next;
    });
  }

  async function submit() {
    if (submitting.current) return;
    const fieldErrors = validateFields(fields);
    if (Object.keys(fieldErrors).length) {
      setFocusField(Object.keys(fieldErrors)[0] as keyof InvitationFields);
      setErrors(fieldErrors);
      setMessage("Vérifie les champs indiqués.");
      return;
    }
    submitting.current = true;
    setFocusField(null);
    setErrors({});
    setMessage("");
    const controller = new AbortController();
    saveController.current = controller;
    try {
      const id = ensureResponseId();
      const response = await save.mutateAsync({
        id,
        input: toInput(fields),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setWasUpdate(Boolean(restore.data));
      setSession({ id: response.id, error: null });
      setDraft(null);
      setIsEditing(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ResponseValidationError) {
        setFocusField(
          (Object.keys(error.fields)[0] as keyof InvitationFields) ?? null,
        );
        setErrors(error.fields);
        setMessage("Vérifie ta réponse.");
      } else {
        setMessage(
          error instanceof StorageUnavailableError
            ? "Impossible d’enregistrer ta réponse. Autorise le stockage dans ton navigateur, puis réessaie."
            : "Impossible d’enregistrer ta réponse. Réessaie.",
        );
      }
    } finally {
      submitting.current = false;
    }
  }

  function edit() {
    if (!restore.data) return;
    setDraft(toFields(restore.data));
    setIsEditing(true);
    setFocusField(null);
    setMessage("");
    setErrors({});
  }

  function retry() {
    const nextSession = readSession();
    setSession(nextSession);
    if (nextSession.error === null && nextSession.id === session.id)
      void restore.refetch();
  }

  return {
    phase,
    fields,
    errors,
    message:
      phase === "load-error"
        ? loadError instanceof StorageUnavailableError
          ? "Autorise le stockage dans ton navigateur pour retrouver ta réponse, puis réessaie."
          : "Impossible de retrouver ta réponse. Réessaie."
        : message,
    pending: save.isPending,
    wasUpdate,
    isEditing,
    focusField,
    updateField,
    submit,
    edit,
    retry,
  };
}
