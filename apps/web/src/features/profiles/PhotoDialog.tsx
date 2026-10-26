import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Notifications } from "../../components/Notifications";
import styles from "./photo-dialog.module.scss";

export function PhotoDialog({
  title,
  eyebrow = "Ta photo, à ta façon.",
  busy = false,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      toast.dismiss("avatar-error");
      toast.dismiss("camera");
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="photo-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onPointerDown={(event) => {
        if (busy || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className={styles.heading}>
        <div>
          <p>{eyebrow}</p>
          <h2 id="photo-dialog-title">{title}</h2>
        </div>
        <button
          type="button"
          aria-label="Fermer"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
      <Notifications id="photo-dialog" local />
    </dialog>,
    document.body,
  );
}
