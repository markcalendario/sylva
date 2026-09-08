import type { ReactElement } from "react";
import type { SpriteState } from "./frames";
import "./mascot.css";

/*
 * The dryad's stand-in, in a theme that has no forest.
 *
 * It used to be a presence dot — the mark beside a name in every chat app
 * there is — chosen because a borrowed shape needs no learning. That was true
 * and it was also joyless: the forest gets a creature that celebrates and
 * panics, and the theme you use in front of other people got a circle.
 *
 * So: a creature, drawn the way this theme draws everything else. Flat, one
 * grey body, and the face inside a dark band — which is the whole trick. A
 * band is a big high-contrast shape, so an expression drawn into it still
 * reads at 24px in a sidebar row, where eyes drawn straight onto the body
 * would silt up into a smudge.
 *
 * Nothing is drawn outside the creature. An earlier version put a badge in the
 * top-right corner — a spinner, a tick, a bang — and it worked, but it cost a
 * quarter of the box: the body had to shrink to leave room for it. The band
 * does that job instead. It takes the state's colour from the dim tokens the
 * theme already ships, which puts the colour in the largest dark shape in the
 * drawing and gives the whole 32×32 back to the creature.
 *
 * Every state then changes three things at once: the eyes, the mouth, and how
 * the body carries itself. Any one alone is a detail you would have to go
 * looking for; the three together is something you catch out of the corner of
 * an eye.
 */

/* The face, in viewBox units. Fixed, because there is one creature. */
const EYE_Y = 14.8;
const EYE_L = 11;
const EYE_R = 21;
const MOUTH_Y = 24.6;

/** A dome that falls straight into rounded shoulders, filling the box. */
const BODY =
  "M 4 16 a 12 12 0 0 1 24 0 v 8 a 5.5 5.5 0 0 1 -5.5 5.5 h -13 a 5.5 5.5 0 0 1 -5.5 -5.5 Z";

/** Both eyes, from a function that draws one. */
function pair(draw: (cx: number, key: string) => ReactElement) {
  return (
    <>
      {draw(EYE_L, "l")}
      {draw(EYE_R, "r")}
    </>
  );
}

/** A closed eye: the lid, shown only for the frames of a blink. */
function lid(cx: number, key: string) {
  return (
    <path
      key={key}
      className="mascot-lid"
      d={`M ${cx - 2.6} ${EYE_Y - 0.5} Q ${cx} ${EYE_Y + 1.7} ${cx + 2.6} ${EYE_Y - 0.5}`}
    />
  );
}

function Eyes({ state }: { state: SpriteState }) {
  switch (state) {
    /* Narrowed on the work, and tracking across it. Deeper than a slit needs
       to be, because these are the one pair of eyes drawn dark on a lit band:
       a hairline that glowed on the dark display would vanish on this one. */
    case "working":
      return (
        <g className="mascot-eyes">
          {pair((cx, key) => (
            <rect
              key={key}
              className="mascot-eye"
              x={cx - 2.5}
              y={EYE_Y - 1.35}
              width={5}
              height={2.7}
              rx={1.35}
            />
          ))}
        </g>
      );
    /* Squeezed shut with pleasure, once, as it lands. */
    case "success":
      return (
        <g className="mascot-eyes">
          {pair((cx, key) => (
            <path
              key={key}
              className="mascot-lid"
              d={`M ${cx - 2.6} ${EYE_Y + 1.1} Q ${cx} ${EYE_Y - 2.6} ${cx + 2.6} ${EYE_Y + 1.1}`}
            />
          ))}
        </g>
      );
    /* Wide, with the pupil shrunk to a point. */
    case "error":
      return (
        <g className="mascot-eyes">
          {pair((cx, key) => (
            <g key={key}>
              <circle className="mascot-eye" cx={cx} cy={EYE_Y} r={3.1} />
              <circle className="mascot-pupil" cx={cx} cy={EYE_Y} r={1.1} />
            </g>
          ))}
        </g>
      );
    /* Looking round the room for you, and blinking while it waits. */
    case "blocked":
      return (
        <g className="mascot-eyes">
          <g className="mascot-open">
            {pair((cx, key) => (
              <circle key={key} className="mascot-eye" cx={cx} cy={EYE_Y} r={2.5} />
            ))}
          </g>
          <g className="mascot-shut">{pair(lid)}</g>
        </g>
      );
    /* Resting: open, with a double blink every few seconds. */
    default:
      return (
        <g className="mascot-eyes">
          <g className="mascot-open">
            {pair((cx, key) => (
              <circle key={key} className="mascot-eye" cx={cx} cy={EYE_Y} r={2.2} />
            ))}
          </g>
          <g className="mascot-shut">{pair(lid)}</g>
        </g>
      );
  }
}

function Mouth({ state }: { state: SpriteState }) {
  switch (state) {
    /* A set line: the face of someone concentrating. */
    case "working":
      return (
        <g className="mascot-mouth">
          <rect
            className="mascot-lips"
            x={14.4}
            y={MOUTH_Y - 0.8}
            width={3.2}
            height={1.6}
            rx={0.8}
          />
        </g>
      );
    case "success":
      return (
        <g className="mascot-mouth">
          <path
            className="mascot-lips"
            d={`M 12.5 ${MOUTH_Y - 0.8} Q 16 ${MOUTH_Y + 3.9} 19.5 ${MOUTH_Y - 0.8} Z`}
          />
        </g>
      );
    /* A small hum, held open. */
    case "blocked":
      return (
        <g className="mascot-mouth">
          <circle className="mascot-lips" cx={16} cy={MOUTH_Y + 0.3} r={1.55} />
        </g>
      );
    case "error":
      return (
        <g className="mascot-mouth">
          <path className="mascot-line" d={`M 12.6 ${MOUTH_Y + 0.5} q 1.7 -2 3.4 0 t 3.4 0`} />
        </g>
      );
    default:
      return (
        <g className="mascot-mouth">
          <path
            className="mascot-line"
            d={`M 13.4 ${MOUTH_Y - 0.3} Q 16 ${MOUTH_Y + 2.4} 18.6 ${MOUTH_Y - 0.3}`}
          />
        </g>
      );
  }
}

export function Mascot({
  state,
  size,
  label,
  tip,
}: {
  state: SpriteState;
  size: number;
  label: string;
  tip: string;
}) {
  return (
    <div
      className={`mascot mascot-${state}`}
      role="img"
      aria-label={label}
      data-tip={tip}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden focusable="false">
        {/*
         * Two layers of movement, because they run on different clocks: the
         * outer one is posture — the slow lean, rock or slump that says what
         * kind of day it is having — and the inner one is breath, which is
         * quick and never stops. Stacking them means neither has to be written
         * in terms of the other.
         */}
        <g className="mascot-tilt">
          <g className="mascot-breath">
            <path className="mascot-skin" d={BODY} />
            <rect className="mascot-visor" x={6.8} y={9.2} width={18.4} height={11.2} rx={5.6} />
            <Eyes state={state} />
            <Mouth state={state} />
          </g>
        </g>
      </svg>
    </div>
  );
}
