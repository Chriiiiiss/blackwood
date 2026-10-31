import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createUuid } from "../../lib/uuid";
import { guestAccessKey } from "../guest-access/queries";
import type { GuestProfile } from "../guest-access/requests";
import { MissionSpoiler } from "./MissionSpoiler";
import styles from "./missions.module.scss";
import {
  confirmationsOptions,
  missionsKey,
  ownMissionsOptions,
  playersOptions,
} from "./queries";
import {
  cancelClaim,
  claimMission,
  decideMission,
  drawMission,
  MissionRequestError,
  missionError,
} from "./requests";

type Action =
  | { kind: "draw"; id: string; after: string | null }
  | {
      kind: "claim";
      assignmentId: string;
      id: string;
      recipientProfileId: string;
    }
  | { kind: "cancel"; id: string }
  | { kind: "decide"; id: string; decision: "confirmed" | "rejected" };
async function perform(action: Action) {
  switch (action.kind) {
    case "draw":
      return drawMission(action.id, action.after);
    case "claim":
      return claimMission(action);
    case "cancel":
      return cancelClaim(action.id);
    case "decide":
      return decideMission(action);
  }
}
export function MissionsPage({ profile }: { profile: GuestProfile }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const own = useQuery(ownMissionsOptions(profile.id));
  const incoming = useQuery(confirmationsOptions(profile.id));
  const players = useQuery(playersOptions(profile.id));
  const [tab, setTab] = useState<"own" | "incoming">("own");
  const [target, setTarget] = useState("");
  const drawDraft = useRef<{ id: string; after: string | null } | null>(null);
  const claimDraft = useRef<{
    assignmentId: string;
    id: string;
    recipientProfileId: string;
  } | null>(null);
  const guard = useRef(false);
  const mutation = useMutation({
    mutationFn: perform,
    retry: false,
    gcTime: 0,
  });
  const error = mutation.error ?? own.error ?? incoming.error ?? players.error;
  useEffect(() => {
    if (
      error instanceof MissionRequestError &&
      [401, 403].includes(error.status)
    ) {
      void client.cancelQueries({ queryKey: missionsKey(profile.id) });
      client.removeQueries({ queryKey: missionsKey(profile.id) });
      void client.invalidateQueries({ queryKey: guestAccessKey });
      if (error.status === 401) void navigate({ to: "/login", replace: true });
    }
  }, [error, client, navigate, profile.id]);
  async function run(action: Action) {
    if (guard.current) return;
    guard.current = true;
    try {
      await mutation.mutateAsync(action);
      if (action.kind === "draw") drawDraft.current = null;
      if (action.kind === "claim") {
        claimDraft.current = null;
        setTarget("");
      }
      const message =
        action.kind === "draw"
          ? "Ta mission est prête."
          : action.kind === "claim"
            ? "Demande de confirmation envoyée."
            : action.kind === "cancel"
              ? "Demande annulée."
              : action.decision === "confirmed"
                ? "Réussite confirmée : un point attribué."
                : "Demande refusée. Aucun point attribué.";
      toast.success(message);
    } catch (error) {
      toast.error(missionError(error));
    } finally {
      await client.invalidateQueries({ queryKey: missionsKey(profile.id) });
      guard.current = false;
    }
  }
  const current = own.data?.current;
  const blocked =
    error instanceof MissionRequestError && [401, 403].includes(error.status);
  return (
    <main className={styles.page}>
      <Link to="/" className={styles.back}>
        ← Retour au hub
      </Link>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Entre nous, {profile.firstName}</p>
        <h1>Les missions.</h1>
        <p>Un petit piège. Une confirmation. Un point.</p>
      </header>
      <nav className={styles.tabs} aria-label="Mes missions et confirmations">
        <button
          type="button"
          aria-pressed={tab === "own"}
          onClick={() => setTab("own")}
        >
          Ma mission
        </button>
        <button
          type="button"
          aria-pressed={tab === "incoming"}
          onClick={() => setTab("incoming")}
        >
          À confirmer{incoming.data?.length ? ` · ${incoming.data.length}` : ""}
        </button>
      </nav>
      {blocked ? (
        <p role="status">Vérification de ton accès…</p>
      ) : tab === "own" ? (
        <section className={styles.panel} aria-labelledby="own-mission-title">
          <p className={styles.eyebrow}>Mon espace</p>
          <h2 id="own-mission-title">Ma mission.</h2>
          {own.isPending ? (
            <p role="status">Ta mission se prépare…</p>
          ) : own.isError ? (
            <LoadError retry={() => void own.refetch()} />
          ) : (
            <>
              <div className={styles.score}>
                <span>Ton score confirmé</span>
                <strong>
                  {own.data.score} {own.data.score === 1 ? "point" : "points"}
                </strong>
              </div>
              {current ? (
                <>
                  <p className={styles.context}>
                    {current.pending
                      ? `En attente de ${current.pending.recipient}`
                      : "Rien que pour toi. À garder secret."}
                  </p>
                  <MissionSpoiler key={current.id} text={current.text} />
                  {current.pending ? (
                    <button
                      type="button"
                      disabled={mutation.isPending}
                      onClick={() =>
                        void run({
                          kind: "cancel",
                          id: current.pending?.id ?? "",
                        })
                      }
                    >
                      Annuler la demande
                    </button>
                  ) : (
                    <form
                      className={styles.actions}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!target) return;
                        if (
                          !claimDraft.current ||
                          claimDraft.current.assignmentId !== current.id ||
                          claimDraft.current.recipientProfileId !== target
                        )
                          claimDraft.current = {
                            assignmentId: current.id,
                            id: createUuid(),
                            recipientProfileId: target,
                          };
                        void run({ kind: "claim", ...claimDraft.current });
                      }}
                    >
                      <label htmlFor="mission-recipient">
                        Qui s’est fait piéger ?
                      </label>
                      {players.isError ? (
                        <LoadError retry={() => void players.refetch()} />
                      ) : (
                        <select
                          id="mission-recipient"
                          value={target}
                          disabled={players.isPending || mutation.isPending}
                          required
                          onChange={(event) =>
                            setTarget(event.currentTarget.value)
                          }
                        >
                          <option value="">Choisir un participant</option>
                          {players.data?.map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.firstName}
                            </option>
                          ))}
                        </select>
                      )}
                      {!players.isPending &&
                        !players.isError &&
                        !players.data?.length && (
                          <p className={styles.context}>
                            Les autres invités apparaîtront ici après avoir tiré
                            leur première mission.
                          </p>
                        )}
                      <button
                        className={styles.primary}
                        type="submit"
                        disabled={
                          !target || players.isError || mutation.isPending
                        }
                      >
                        Faire confirmer
                      </button>
                    </form>
                  )}
                </>
              ) : own.data.exhausted ? (
                <p>Toutes les missions sont accomplies. Bien joué !</p>
              ) : (
                <>
                  <p className={styles.context}>
                    {own.data.score
                      ? "Bien joué. La prochaine victime n’attend que toi."
                      : "Tire une mission, puis fais-la confirmer par la personne piégée."}
                  </p>
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => {
                      drawDraft.current ??= {
                        id: createUuid(),
                        after: own.data.history[0]?.id ?? null,
                      };
                      void run({ kind: "draw", ...drawDraft.current });
                    }}
                  >
                    {own.data.score
                      ? "Tirer ma prochaine mission"
                      : "Obtenir ma première mission"}
                  </button>
                </>
              )}
              {!!own.data.history.length && (
                <details className={styles.history}>
                  <summary>
                    Mes missions réussies · {own.data.history.length}
                  </summary>
                  {own.data.history.map((mission) => (
                    <div key={mission.id}>
                      <MissionSpoiler
                        text={mission.text}
                        label="Mission réussie"
                      />
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </section>
      ) : (
        <section aria-labelledby="incoming-title" className={styles.incoming}>
          <h2 id="incoming-title" className="visually-hidden">
            Demandes de confirmation
          </h2>
          {incoming.isPending ? (
            <p role="status">Je retrouve les demandes…</p>
          ) : incoming.isError ? (
            <LoadError retry={() => void incoming.refetch()} />
          ) : !incoming.data.length ? (
            <div className={`${styles.panel} ${styles.confirmation}`}>
              <p className={styles.eyebrow}>À confirmer</p>
              <h2>Personne ne t’a eu ?</h2>
              <p className={styles.context}>
                Les demandes des autres invités apparaîtront ici. Tu peux
                confirmer sans avoir encore tiré de mission.
              </p>
            </div>
          ) : (
            incoming.data.map((claim) => (
              <article
                key={claim.id}
                className={`${styles.panel} ${styles.confirmation}`}
                aria-label={`Demande de ${claim.firstName}`}
              >
                <p className={styles.eyebrow}>Demande de confirmation</p>
                <h2>À confirmer.</h2>
                <div className={styles.sender}>
                  <span aria-hidden="true">{claim.firstName.slice(0, 1)}</span>
                  <p>
                    <strong>{claim.firstName}</strong>
                    <small>te demande de confirmer sa mission</small>
                  </p>
                </div>
                <p className={styles.context}>
                  Est-ce que {claim.firstName} t’a eu ?
                </p>
                <MissionSpoiler
                  text={claim.text}
                  label={`La mission de ${claim.firstName}`}
                />
                <p className={styles.context}>
                  Ta confirmation lui rapporte 1 point.
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() =>
                      void run({
                        kind: "decide",
                        id: claim.id,
                        decision: "confirmed",
                      })
                    }
                  >
                    Confirmer la réussite
                  </button>
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() =>
                      void run({
                        kind: "decide",
                        id: claim.id,
                        decision: "rejected",
                      })
                    }
                  >
                    Refuser
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      )}
    </main>
  );
}
function LoadError({ retry }: { retry: () => void }) {
  return (
    <div>
      <p role="alert">Impossible de charger les missions.</p>
      <button type="button" onClick={retry}>
        Réessayer
      </button>
    </div>
  );
}
