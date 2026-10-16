import { Toaster } from "sonner";
import styles from "./notifications.module.scss";

export function Notifications({
  id,
  local = false,
}: {
  id?: string;
  local?: boolean;
}) {
  return (
    <Toaster
      {...(id ? { id } : {})}
      theme="dark"
      position="bottom-center"
      closeButton
      duration={6000}
      visibleToasts={2}
      customAriaLabel="Notifications"
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "Fermer la notification",
        classNames: {
          toast: styles.toast ?? "",
          title: styles.title ?? "",
          closeButton: styles.close ?? "",
          success: styles.success ?? "",
          error: styles.error ?? "",
        },
      }}
      {...(local
        ? {
            style: {
              position: "relative",
              width: "100%",
              left: "auto",
              right: "auto",
              bottom: "auto",
              height: "var(--front-toast-height)",
              marginTop: "1rem",
            },
          }
        : {})}
    />
  );
}
