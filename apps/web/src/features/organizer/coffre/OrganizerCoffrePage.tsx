import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ContributionForm } from "../../coffre/ContributionForm";
import { clockLabel, coffreTime, useCoffreClock } from "../../coffre/clock";
import { ModelPreview } from "../../coffre/preview/ModelPreview";
import { PhotoDialog } from "../../profiles/PhotoDialog";
import { useOrganizerLayout } from "../OrganizerLayout";
import { OrganizerRequestError } from "../requests";
import styles from "./organizer-coffre.module.scss";
import {
  contributionQuery,
  metadataQuery,
  organizerCoffreKey,
  organizerCoffreQuery,
} from "./queries";
import {
  advanceCoffre,
  type ContributionMetadata,
  deleteContribution,
  openCoffre,
  organizerCoffreError,
  prepareCoffre,
  startCoffre,
} from "./requests";

const labels = {
  unprepared: "À préparer",
  prepared: "Prêt pour la soirée",
  collecting: "Les dépôts sont ouverts",
  revealed: "Le Coffre est ouvert",
};
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
export function OrganizerCoffrePage() {
  const { expire, coffreComposer } = useOrganizerLayout();
  const client = useQueryClient();
  const query = useQuery(organizerCoffreQuery());
  const remaining = useCoffreClock(query.data);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [composer, setComposer] = useState(
    () =>
      !!(
        coffreComposer[0].attempt ||
        coffreComposer[0].draft.text ||
        coffreComposer[0].draft.file
      ),
  );
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const operation = useMutation({
    mutationFn: (
      command:
        | { kind: "prepare"; seconds: number }
        | { kind: "start" | "open" }
        | { kind: "advance"; deadline: string },
    ) => {
      if (command.kind === "prepare") return prepareCoffre(command.seconds);
      if (command.kind === "advance") return advanceCoffre(command.deadline);
      return command.kind === "start" ? startCoffre() : openCoffre();
    },
    retry: false,
    gcTime: 0,
  });
  const unauthenticated = [operation.error, query.error].some(
    (error) => error instanceof OrganizerRequestError && error.status === 401,
  );
  useEffect(() => {
    if (unauthenticated) expire();
  }, [unauthenticated, expire]);
  const atDeadline = query.data?.state === "collecting" && remaining === 0;
  useEffect(() => {
    if (atDeadline) void query.refetch();
  }, [atDeadline, query.refetch]);
  async function run(command: Parameters<typeof operation.mutateAsync>[0]) {
    if (guard.current) return;
    guard.current = true;
    try {
      const result = await operation.mutateAsync(command);
      if (!mounted.current) return;
      client.setQueryData(organizerCoffreQuery().queryKey, result);
      setConfirmOpen(false);
      toast.success(
        command.kind === "prepare"
          ? "Le Coffre est prêt."
          : command.kind === "start"
            ? "Le compte à rebours est lancé."
            : command.kind === "advance"
              ? "L’ouverture a été avancée."
              : "Le Coffre est ouvert.",
      );
      await client.invalidateQueries({ queryKey: organizerCoffreKey });
    } catch (caught) {
      if (!mounted.current) return;
      if (!(caught instanceof OrganizerRequestError && caught.status === 401)) {
        setConfirmOpen(false);
        toast.error(organizerCoffreError(caught));
        void query.refetch();
      }
    } finally {
      guard.current = false;
    }
  }
  return (
    <section className={styles.page} aria-labelledby="organizer-coffre-title">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Les souvenirs de la soirée</p>
          <h2 id="organizer-coffre-title">Le Coffre.</h2>
        </div>
        <button
          type="button"
          className={styles.secondary}
          onClick={() =>
            void client.invalidateQueries({ queryKey: organizerCoffreKey })
          }
        >
          Actualiser le Coffre
        </button>
      </header>
      {query.isPending ? (
        <p role="status">Chargement du Coffre…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Impossible de vérifier le Coffre.</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void query.refetch()}
          >
            Réessayer le Coffre
          </button>
        </div>
      ) : (
        <>
          <section
            className={styles.panel}
            aria-label="État et compte à rebours"
          >
            <p className={styles.eyebrow}>{labels[query.data.state]}</p>
            {(query.data.state === "unprepared" ||
              query.data.state === "prepared") && (
              <>
                <p>
                  Choisis la durée avant de lancer le compteur. Tu peux déjà
                  déposer tes propres souvenirs une fois le Coffre préparé.
                </p>
                <DurationForm
                  key={query.data.durationSeconds ?? "new"}
                  initial={query.data.durationSeconds}
                  label="Durée du compte à rebours"
                  action={
                    query.data.state === "prepared"
                      ? "Enregistrer la durée"
                      : "Préparer le Coffre"
                  }
                  busy={operation.isPending}
                  onSubmit={(seconds) => void run({ kind: "prepare", seconds })}
                />
                {query.data.state === "prepared" && (
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={operation.isPending}
                    onClick={() => void run({ kind: "start" })}
                  >
                    Lancer le compte à rebours
                  </button>
                )}
              </>
            )}
            {query.data.state === "collecting" && (
              <>
                <p
                  className={styles.timer}
                  role="timer"
                  aria-label={`Temps restant : ${clockLabel(remaining)}`}
                >
                  {clockLabel(remaining)}
                </p>
                <p>
                  Révélation prévue le{" "}
                  {dateLabel(query.data.deadline ?? query.data.serverNow)}. Les
                  invités peuvent déposer jusqu’à cette échéance.
                </p>
                <DurationForm
                  label="Nouveau temps restant"
                  action="Avancer l’ouverture"
                  busy={operation.isPending || atDeadline}
                  onSubmit={(seconds) => {
                    const state = query.data;
                    if (!state || seconds >= remaining) {
                      toast.error(
                        "Choisis une durée plus courte que le temps restant.",
                      );
                      return;
                    }
                    void run({
                      kind: "advance",
                      deadline: new Date(
                        coffreTime(state) + seconds * 1000,
                      ).toISOString(),
                    });
                  }}
                />
                <button
                  type="button"
                  className={styles.destructive}
                  disabled={operation.isPending || atDeadline}
                  onClick={() => setConfirmOpen(true)}
                >
                  Ouvrir maintenant
                </button>
              </>
            )}
            {query.data.state === "revealed" && (
              <p>
                Les dépôts sont fermés. Les souvenirs partagés sont visibles aux
                invités ; les privés restent dans cet espace.
              </p>
            )}
          </section>
          {query.data.state !== "unprepared" &&
            query.data.state !== "revealed" &&
            !composer && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setComposer(true)}
              >
                Déposer un souvenir
              </button>
            )}
        </>
      )}
      {composer && (
        <section className={styles.panel} aria-label="Ton dépôt organisateur">
          <h3>Ton souvenir</h3>
          <ContributionForm
            organizer
            composerState={coffreComposer}
            collecting={
              !query.isError &&
              (query.data?.state === "prepared" ||
                (query.data?.state === "collecting" && !atDeadline))
            }
            canReadState={!query.isError}
            closed={atDeadline || query.data?.state === "revealed"}
            onAccessError={expire}
            onStateChange={() =>
              void client.invalidateQueries({ queryKey: organizerCoffreKey })
            }
          />
        </section>
      )}
      {!query.isError && query.data && <ContributionList />}
      {confirmOpen && (
        <PhotoDialog
          title="Ouvrir le Coffre maintenant ?"
          eyebrow="Une ouverture définitive"
          busy={operation.isPending}
          onClose={() => setConfirmOpen(false)}
        >
          <p>
            Les nouveaux dépôts seront fermés et les souvenirs partagés seront
            révélés aux invités. Les privés resteront réservés à ton espace
            organisateur.
          </p>
          <p>Tu ne pourras pas refermer ni relancer ce Coffre.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.destructive}
              disabled={operation.isPending}
              onClick={() => void run({ kind: "open" })}
            >
              {operation.isPending ? "Ouverture…" : "Confirmer l’ouverture"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={operation.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              Annuler
            </button>
          </div>
        </PhotoDialog>
      )}
    </section>
  );
}

function DurationForm({
  initial,
  label,
  action,
  busy,
  onSubmit,
}: {
  initial?: number | null;
  label: string;
  action: string;
  busy: boolean;
  onSubmit: (seconds: number) => void;
}) {
  const initialUnit = initial
    ? initial % 3600 === 0
      ? 3600
      : initial % 60 === 0
        ? 60
        : 1
    : 60;
  const [unit, setUnit] = useState(initialUnit);
  const [amount, setAmount] = useState(
    initial ? String(initial / initialUnit) : "",
  );
  return (
    <form
      className={styles.duration}
      onSubmit={(event) => {
        event.preventDefault();
        const seconds = Number(amount) * unit;
        if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 604800) {
          toast.error(
            "Choisis une durée comprise entre une seconde et sept jours.",
          );
          return;
        }
        onSubmit(seconds);
      }}
    >
      <label>
        {label}
        <input
          type="number"
          min="1"
          max={Math.floor(604800 / unit)}
          step="1"
          required
          value={amount}
          disabled={busy}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        Unité
        <select
          value={unit}
          disabled={busy}
          onChange={(event) => setUnit(Number(event.target.value))}
        >
          <option value="1">Secondes</option>
          <option value="60">Minutes</option>
          <option value="3600">Heures</option>
        </select>
      </label>
      <button type="submit" className={styles.secondary} disabled={busy}>
        {action}
      </button>
    </form>
  );
}

function ContributionList() {
  const { expire } = useOrganizerLayout();
  const client = useQueryClient();
  const [filter, setFilter] = useState<"" | "public" | "private">("");
  const [selected, setSelected] = useState<ContributionMetadata | null>(null);
  const [removing, setRemoving] = useState<ContributionMetadata | null>(null);
  const query = useInfiniteQuery(metadataQuery(filter));
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const remove = useMutation({
    mutationFn: deleteContribution,
    retry: false,
    gcTime: 0,
  });
  const unauthenticated = [remove.error, query.error].some(
    (error) => error instanceof OrganizerRequestError && error.status === 401,
  );
  useEffect(() => {
    if (unauthenticated) expire();
  }, [unauthenticated, expire]);
  async function confirmDelete() {
    if (!removing || guard.current) return;
    guard.current = true;
    try {
      await remove.mutateAsync(removing.id);
      if (!mounted.current) return;
      setRemoving(null);
      toast.success("Le souvenir a été supprimé.");
      await client.invalidateQueries({ queryKey: organizerCoffreKey });
    } catch (caught) {
      if (!mounted.current) return;
      if (!(caught instanceof OrganizerRequestError && caught.status === 401))
        toast.error(organizerCoffreError(caught), {
          toasterId: "photo-dialog",
        });
    } finally {
      guard.current = false;
    }
  }
  const rows = query.data?.pages.flatMap((page) => page.contributions) ?? [];
  return (
    <section className={styles.panel} aria-labelledby="coffre-deposits-title">
      <div className={styles.heading}>
        <h3 id="coffre-deposits-title">Les souvenirs</h3>
        <label>
          Visibilité
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
          >
            <option value="">Tous</option>
            <option value="public">Partagés</option>
            <option value="private">Privés</option>
          </select>
        </label>
      </div>
      <p className={styles.muted}>
        Le contenu reste fermé jusqu’à ce que tu choisisses « Consulter ». Tu
        peux supprimer un souvenir directement.
      </p>
      {query.isPending ? (
        <p role="status">Chargement des souvenirs…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Impossible de charger les souvenirs.</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void query.refetch()}
          >
            Réessayer les souvenirs
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p>Aucun souvenir pour ce filtre.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.author?.firstName ?? "Organisateur"}</strong>
                <p>
                  {row.visibility === "private"
                    ? "Privé"
                    : "Partagé à la révélation"}{" "}
                  ·{" "}
                  {row.hasText && row.hasPhoto
                    ? "Message et photo"
                    : row.hasPhoto
                      ? "Photo"
                      : "Message"}
                </p>
                <p>
                  {dateLabel(row.createdAt)} ·{" "}
                  {row.frameId === "one-wish-willow"
                    ? "One Wish Willow"
                    : "Classique"}
                </p>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setSelected(row)}
                >
                  Consulter
                </button>
                <button
                  type="button"
                  className={styles.destructive}
                  onClick={() => setRemoving(row)}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!query.isError && query.hasNextPage && (
        <button
          type="button"
          className={styles.secondary}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Voir d’autres souvenirs
        </button>
      )}
      {selected && (
        <ContributionViewer
          id={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
      {removing && (
        <PhotoDialog
          title="Supprimer ce souvenir ?"
          eyebrow="Une suppression définitive"
          busy={remove.isPending}
          onClose={() => {
            setRemoving(null);
            remove.reset();
          }}
        >
          <p>
            Ce souvenir de {removing.author?.firstName ?? "l’organisateur"} sera
            supprimé de la liste et de la diffusion. Son contenu n’a pas besoin
            d’être ouvert pour cette action.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.destructive}
              disabled={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {remove.isPending ? "Suppression…" : "Confirmer la suppression"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={remove.isPending}
              onClick={() => setRemoving(null)}
            >
              Annuler
            </button>
          </div>
        </PhotoDialog>
      )}
    </section>
  );
}
function ContributionViewer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { expire } = useOrganizerLayout();
  const query = useQuery(contributionQuery(id));
  useEffect(() => {
    if (
      query.error instanceof OrganizerRequestError &&
      query.error.status === 401
    )
      expire();
  }, [query.error, expire]);
  return (
    <PhotoDialog
      title="Un souvenir du Coffre"
      eyebrow="Consultation privée"
      onClose={onClose}
    >
      {query.isPending ? (
        <p role="status">Ouverture du souvenir…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Ce souvenir n’est plus disponible ou n’a pas pu être chargé.</p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void query.refetch()}
          >
            Réessayer la consultation
          </button>
        </div>
      ) : (
        <>
          <p>
            {query.data.author?.firstName ?? "Organisateur"} ·{" "}
            {query.data.visibility === "private" ? "Privé" : "Partagé"}
          </p>
          <ModelPreview
            text={query.data.text}
            image={
              query.data.photoMediaId
                ? `/api/media/${query.data.photoMediaId}/image`
                : null
            }
            frameId={query.data.frameId}
            readable
          />
        </>
      )}
    </PhotoDialog>
  );
}
