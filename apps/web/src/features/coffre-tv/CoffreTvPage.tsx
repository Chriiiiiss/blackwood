import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clockLabel, useCoffreClock } from "../coffre/clock";
import { CoffreRequestError, type CoffreState } from "../coffre/requests";
import { tvContributionsQuery, tvKey, tvStateQuery } from "./queries";
import { TvLogin } from "./TvLogin";
import { TvScene } from "./TvScene";
import styles from "./tv.module.scss";

export function CoffreTvPage() {
  const client = useQueryClient();
  const query = useQuery(tvStateQuery());
  const [visible, setVisible] = useState(!document.hidden);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [hint, setHint] = useState("");
  const generation = useRef(0);
  const stage = useRef<HTMLElement>(null);
  const verify = useCallback(async () => {
    const current = ++generation.current;
    setVisible(false);
    await client.cancelQueries({ queryKey: [...tvKey, "contributions"] });
    client.removeQueries({ queryKey: [...tvKey, "contributions"] });
    const result = await query.refetch();
    if (current === generation.current && !document.hidden) setVisible(true);
    return result;
  }, [client, query.refetch]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        generation.current++;
        setVisible(false);
      } else void verify();
    };
    const full = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", full);
    window.addEventListener("online", verify);
    return () => {
      generation.current++;
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", full);
      window.removeEventListener("online", verify);
    };
  }, [verify]);
  const error = query.error;
  const unauthenticated =
    error instanceof CoffreRequestError && error.status === 401;
  const closedHub =
    error instanceof CoffreRequestError && error.code === "HUB_CLOSED";
  return (
    <main ref={stage} className={styles.tv}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span>Hôtel</span> Blackwood
        </Link>
        <div className={styles.headerActions}>
          <span>La nuit laisse une trace.</span>
          <button
            type="button"
            onClick={async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else if (stage.current?.requestFullscreen)
                  await stage.current.requestFullscreen();
                else
                  setHint(
                    "Utilise le plein écran de ton navigateur pour agrandir la projection.",
                  );
              } catch {
                setHint(
                  "Utilise le plein écran de ton navigateur pour agrandir la projection.",
                );
              }
            }}
          >
            {fullscreen ? "Quitter le plein écran" : "Plein écran"}
          </button>
        </div>
      </header>
      {hint && (
        <p className={styles.hint} role="status">
          {hint}
        </p>
      )}
      {unauthenticated ? (
        <TvLogin onLogin={verify} />
      ) : query.isError ? (
        <section className={styles.gate} role="alert">
          <p className={styles.eyebrow}>
            {closedHub
              ? "Chaque chose en son temps"
              : "Une petite interruption"}
          </p>
          <h1>
            {closedHub
              ? "La soirée n’a pas encore ouvert ses portes."
              : "La projection va reprendre."}
          </h1>
          <p>
            {closedHub
              ? "Ton accès est conservé. La projection sera disponible quand Chris ouvrira le hub."
              : "Impossible de vérifier le Coffre. Les souvenirs restent masqués le temps de rétablir la connexion."}
          </p>
          <button type="button" onClick={() => void verify()}>
            Réessayer la projection
          </button>
        </section>
      ) : query.isPending || !visible ? (
        <section className={styles.gate}>
          <p role="status">La projection se prépare…</p>
        </section>
      ) : (
        <TvExperience
          key={query.data.id ?? "waiting"}
          state={query.data}
          verify={verify}
        />
      )}
      <footer className={styles.footer}>
        <span>Halloween 2026</span>
        <span>Ce qui se vit ici reste entre nous.</span>
      </footer>
    </main>
  );
}
function TvExperience({
  state,
  verify,
}: {
  state: CoffreState;
  verify: () => Promise<unknown>;
}) {
  const remaining = useCoffreClock(state);
  const atDeadline = state.state === "collecting" && remaining === 0;
  useEffect(() => {
    if (atDeadline) void verify();
  }, [atDeadline, verify]);
  return (
    <>
      {state.state === "revealed" && state.id ? (
        <Revelation coffreId={state.id} name={state.name} verify={verify} />
      ) : (
        <>
          <TvScene items={emptyItems} onPhotoFailure={() => void verify()} />
          <section
            className={styles.countdown}
            aria-labelledby="tv-countdown-title"
          >
            <p className={styles.eyebrow}>
              {state.name ?? "Le Coffre de cette nuit"}
            </p>
            <h1 id="tv-countdown-title">
              {state.state === "collecting"
                ? "Les secrets prennent leur temps."
                : "Les souvenirs se préparent."}
            </h1>
            {state.state === "collecting" ? (
              <>
                <p
                  className={styles.clock}
                  role="timer"
                  aria-label={`Révélation dans ${clockLabel(remaining)}`}
                >
                  {clockLabel(remaining)}
                </p>
                <p>
                  {atDeadline
                    ? "Le Coffre s’ouvre…"
                    : "Glisse un mot ou une photo dans le Coffre depuis ton téléphone."}
                </p>
              </>
            ) : (
              <p>
                Chris lancera le compte à rebours au bon moment. Les souvenirs
                resteront à l’abri jusque-là.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
const emptyItems: [] = [];
function Revelation({
  coffreId,
  name,
  verify,
}: {
  coffreId: number;
  name: string | null;
  verify: () => Promise<unknown>;
}) {
  const query = useInfiniteQuery(tvContributionsQuery(coffreId));
  const [mediaBlocked, setMediaBlocked] = useState(false);
  const rows = useMemo(
    () =>
      query.data?.pages
        .flatMap((page) => page.contributions)
        .filter(
          (item, index, all) =>
            all.findIndex((other) => other.id === item.id) === index,
        ) ?? [],
    [query.data],
  );
  useEffect(() => {
    if (query.hasNextPage && !query.isFetching && !query.isError)
      void query.fetchNextPage();
  }, [query.hasNextPage, query.isFetching, query.isError, query.fetchNextPage]);
  useEffect(() => {
    if (
      query.error instanceof CoffreRequestError &&
      [401, 403, 404].includes(query.error.status)
    )
      void verify();
  }, [query.error, verify]);
  if (mediaBlocked)
    return (
      <section className={styles.gate} role="alert">
        <h1>Une image s’est égarée.</h1>
        <p>
          La diffusion est masquée. Réessaie pour vérifier l’accès et retrouver
          les souvenirs disponibles.
        </p>
        <button type="button" onClick={() => void verify()}>
          Réessayer la projection
        </button>
      </section>
    );
  if (query.isError)
    return (
      <section className={styles.gate} role="alert">
        <h1>Un instant, les souvenirs reviennent.</h1>
        <p>La diffusion est masquée pendant la reconnexion.</p>
        <button type="button" onClick={() => void verify()}>
          Réessayer la projection
        </button>
      </section>
    );
  if (query.isPending || query.hasNextPage)
    return (
      <section className={styles.gate}>
        <p role="status">On rassemble les souvenirs de cette nuit…</p>
      </section>
    );
  return (
    <>
      <div className={styles.revelationTitle}>
        <p className={styles.eyebrow}>Le Coffre est ouvert</p>
        <h1>{name ?? "Ce qu’on garde de cette nuit."}</h1>
      </div>
      <TvScene items={rows} onPhotoFailure={() => setMediaBlocked(true)} />
      {!rows.length && (
        <section className={styles.empty}>
          <h2>La nuit garde encore ses secrets.</h2>
          <p>Aucun souvenir partagé dans ce Coffre.</p>
        </section>
      )}
      <p className={styles.rotationNote}>
        {rows.length
          ? `${rows.length} souvenir${rows.length > 1 ? "s" : ""} · au fil de la nuit`
          : ""}
      </p>
    </>
  );
}
