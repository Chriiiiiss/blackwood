import { useLayoutEffect, useRef, useState } from "react";
import styles from "./OneWishWillowCard.module.scss";
import printSrc from "./one-wish-willow.svg";
import { prismGeometry } from "./prismGeometry";

/** Stable persistence ID; artwork revisions must not change this identifier. */
export const ONE_WISH_WILLOW_THEME_ID = "one-wish-willow" as const;

type Props = { message: string };

/** Visual proposal awaiting approval; no contribution transport or persistence. */
export function OneWishWillowCard({ message }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(750);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) {
        setHeight(
          Math.round((1000 * element.clientHeight) / element.clientWidth),
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = prismGeometry(height);

  return (
    <article
      className={styles.card}
      data-theme={ONE_WISH_WILLOW_THEME_ID}
      data-composition="message"
      aria-label="Vœu One Wish Willow"
    >
      <div ref={card} className={styles.box}>
        <svg
          className={styles.paper}
          viewBox={`0 0 1000 ${height}`}
          aria-hidden="true"
        >
          <title>One Wish Willow triangular prism box</title>
          <path fill="#f6e5cc" d={geometry.outline} />
          <path fill="#f9ead5" d={geometry.upperFace} />
          <path fill="#d4b899" d={geometry.endFace} />
          <path
            fill="none"
            stroke="#ba9b7a"
            strokeWidth="1.5"
            d={geometry.edges}
          />
        </svg>
        <p
          className={styles.message}
          data-length={message.length > 220 ? "long" : "short"}
        >
          {message}
        </p>
        <img
          className={styles.print}
          data-artwork="one-wish-willow"
          src={printSrc}
          alt=""
          width="2376"
          height="594"
        />
      </div>
    </article>
  );
}
