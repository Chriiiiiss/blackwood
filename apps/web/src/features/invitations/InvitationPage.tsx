import type { GuestProfile } from "../guest-access/requests";
import styles from "./InvitationPage.module.scss";
import { InvitationResponse } from "./InvitationResponse";

export function InvitationPage({ profile }: { profile: GuestProfile | null }) {
  return (
    <main className={styles.invitationLayout}>
      <div className={styles.hotelStory}>
        <h1>
          <span>Viens hanter</span> l’Hôtel Blackwood.
        </h1>
        <p className={styles.storyDescription}>
          Je vous convie dans mon super hôtel pour un super Halloween. Enfile
          ton plus beau costume !
        </p>
        <p className={styles.hostSignature}>— Chris</p>
      </div>
      <div id="guest-register" className={styles.registerWrap} tabIndex={-1}>
        <InvitationResponse profile={profile} />
      </div>
    </main>
  );
}
