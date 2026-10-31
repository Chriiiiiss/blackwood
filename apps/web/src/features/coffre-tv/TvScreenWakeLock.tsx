import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const notification = { id: "tv-wake-lock-status", toasterId: "tv-screen" };

export function TvScreenWakeLock() {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const wanted = useRef(false);
  const mounted = useRef(false);
  const requesting = useRef(false);
  const generation = useRef(0);

  const acquire = useCallback(async (feedback: boolean) => {
    if (
      !mounted.current ||
      !wanted.current ||
      document.hidden ||
      requesting.current
    )
      return;
    if (!navigator.wakeLock?.request) {
      wanted.current = false;
      toast.info(
        "Ce navigateur ne permet pas de demander le maintien de l’écran.",
        notification,
      );
      return;
    }
    const current = ++generation.current;
    requesting.current = true;
    setPending(true);
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (
        !mounted.current ||
        current !== generation.current ||
        !wanted.current ||
        document.hidden
      ) {
        void lock.release().catch(() => {});
        return;
      }
      sentinel.current = lock;
      setActive(true);
      lock.addEventListener(
        "release",
        () => {
          if (sentinel.current !== lock) return;
          sentinel.current = null;
          setActive(false);
          if (!document.hidden && wanted.current) {
            wanted.current = false;
            toast.info(
              "Le navigateur a interrompu le maintien de l’écran.",
              notification,
            );
          }
        },
        { once: true },
      );
      if (feedback)
        toast.success(
          "Demande acceptée. Attends deux minutes pour vérifier la protection OLED.",
          notification,
        );
    } catch {
      if (!mounted.current || current !== generation.current) return;
      wanted.current = false;
      setActive(false);
      toast.error(
        "Le navigateur a refusé de garder l’écran allumé.",
        notification,
      );
    } finally {
      if (mounted.current && current === generation.current) {
        requesting.current = false;
        setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const visibility = () => {
      if (document.hidden) {
        generation.current++;
        requesting.current = false;
        setPending(false);
        const lock = sentinel.current;
        sentinel.current = null;
        setActive(false);
        if (lock) void lock.release().catch(() => {});
      } else if (wanted.current) {
        void acquire(false);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      wanted.current = false;
      generation.current++;
      document.removeEventListener("visibilitychange", visibility);
      const lock = sentinel.current;
      sentinel.current = null;
      if (lock) void lock.release().catch(() => {});
      toast.dismiss(notification.id);
    };
  }, [acquire]);

  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={pending}
      title={
        active
          ? "Désactiver la demande de maintien de l’écran"
          : "Demander au navigateur de garder l’écran allumé"
      }
      onClick={() => {
        if (requesting.current) return;
        if (sentinel.current) {
          wanted.current = false;
          generation.current++;
          const lock = sentinel.current;
          sentinel.current = null;
          setActive(false);
          void lock.release().catch(() => {});
          toast.info("Maintien de l’écran désactivé.", notification);
        } else {
          wanted.current = true;
          void acquire(true);
        }
      }}
    >
      {pending
        ? "Demande…"
        : active
          ? "Maintien de l’écran activé"
          : "Garder l’écran allumé"}
    </button>
  );
}
