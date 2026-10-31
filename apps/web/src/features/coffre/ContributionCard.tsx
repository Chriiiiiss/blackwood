import { useState } from "react";
import styles from "./coffre.module.scss";
import type { FrameId } from "./requests";
import { OneWishWillowCard } from "./themes/one-wish-willow/OneWishWillowCard";

export function ContributionCard({
  text,
  image,
  frameId,
  preview = false,
}: {
  text: string | null;
  image: string | null;
  frameId: FrameId;
  preview?: boolean;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  if (frameId === "one-wish-willow" && !image)
    return <OneWishWillowCard message={text ?? "Ton vœu ici"} />;
  return (
    <div className={styles.contribution}>
      {image && broken !== image && (
        <img
          src={image}
          alt={preview ? "Ton aperçu" : "Souvenir partagé"}
          onError={() => setBroken(image)}
          loading={preview ? "eager" : "lazy"}
        />
      )}
      {image && broken === image && (
        <p className={styles.photoFallback}>
          {preview
            ? "L’aperçu de cette photo n’est pas disponible dans ton navigateur. Le fichier original sera vérifié à l’envoi."
            : "Cette photo n’est plus disponible."}
        </p>
      )}
      {text && <p className={styles.message}>{text}</p>}
      {!text && !image && (
        <p className={styles.placeholder}>Ton message ou ta photo ici</p>
      )}
    </div>
  );
}
