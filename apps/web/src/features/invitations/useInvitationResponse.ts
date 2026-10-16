import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { guestAccessKey } from "../guest-access/queries";
import {
  type GuestProfile,
  restoreGuestAccess,
} from "../guest-access/requests";
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

export function useInvitationResponse(profile: GuestProfile | null) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(readSession);
  const [draft, setDraft] = useState<InvitationFields | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [focusField, setFocusField] = useState<keyof InvitationFields | null>(
    null,
  );
  const submitting = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const currentId = profile?.id ?? session.id;
  const storageError = profile ? null : session.error;

  const restore = useQuery({
    ...invitationResponseOptions(currentId, Boolean(profile)),
    enabled: storageError === null,
  });
  const save = useMutation({
    ...saveInvitationOptions,
    onSuccess: (response, variables) => {
      queryClient.setQueryData(
        invitationResponseKey(variables.id, variables.authenticated),
        response,
      );
      if (profile)
        queryClient.setQueryData(
          guestAccessKey,
          (
            access:
              | { hubEnabled: boolean; profile: GuestProfile | null }
              | undefined,
          ) =>
            access
              ? {
                  ...access,
                  profile: { ...profile, firstName: response.firstName },
                }
              : access,
        );
    },
  });

  useEffect(() => () => saveController.current?.abort(), []);

  const savedFields = restore.data
    ? toFields({
        ...restore.data,
        ...(profile ? { firstName: profile.firstName } : {}),
      })
    : emptyFields;
  const fields = draft ?? savedFields;
  const loadError = storageError ?? restore.error;
  const phase =
    storageError !== null
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
      const id = profile?.id ?? ensureResponseId();
      const response = await save.mutateAsync({
        id,
        input: toInput(fields),
        signal: controller.signal,
        authenticated: Boolean(profile),
      });
      if (controller.signal.aborted) return;
      toast.success(
        restore.data
          ? "Ta réponse a bien été mise à jour."
          : "Ta réponse a bien été enregistrée. Merci !",
        { id: "invitation-save" },
      );
      if (!profile) setSession({ id, error: null });
      setDraft(null);
      setIsEditing(false);
      if (!profile) {
        void restoreGuestAccess(id, controller.signal)
          .then((access) => {
            if (access && !controller.signal.aborted) {
              if (access.profile)
                queryClient.setQueryData(
                  invitationResponseKey(access.profile.id, true),
                  response,
                );
              queryClient.setQueryData(guestAccessKey, access);
            }
          })
          .catch(() => {
            // The response is saved; access exchange can be retried on navigation.
          });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ResponseValidationError) {
        setFocusField(
          (Object.keys(error.fields)[0] as keyof InvitationFields) ?? null,
        );
        setErrors(error.fields);
        setMessage("Vérifie ta réponse.");
      } else {
        toast.error(
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
    setDraft(savedFields);
    setIsEditing(true);
    setFocusField(null);
    setMessage("");
    setErrors({});
  }

  function retry() {
    if (profile) {
      void restore.refetch();
      return;
    }
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
    isEditing,
    focusField,
    updateField,
    submit,
    edit,
    retry,
  };
}
