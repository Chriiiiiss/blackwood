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
      icons={{
        success: <StatusIcon kind="success" />,
        error: <StatusIcon kind="error" />,
        info: <StatusIcon kind="info" />,
        warning: <StatusIcon kind="error" />,
      }}
      duration={6000}
      visibleToasts={2}
      mobileOffset={local ? 0 : 16}
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
          info: styles.info ?? "",
          warning: styles.info ?? "",
        },
      }}
      {...(local
        ? {
            style: {
              position: "relative",
              transform: "none",
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

function StatusIcon({ kind }: { kind: "success" | "error" | "info" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "success" ? (
        <path d="m5 12 4 4L19 6" />
      ) : (
        <>
          <circle cx="12" cy="12" r="8" />
          <path
            d={kind === "info" ? "M12 11v5M12 8h.01" : "M12 7v5M12 16h.01"}
          />
        </>
      )}
    </svg>
  );
}
