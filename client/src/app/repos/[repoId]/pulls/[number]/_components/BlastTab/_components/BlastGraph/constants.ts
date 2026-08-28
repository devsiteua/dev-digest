/** Geometry of the blast graph. The design's artboard, in named numbers. */

/** Drawing width. The container scrolls horizontally rather than reflowing. */
export const VIEW_WIDTH = 560;

/** The shortest the drawing ever gets — the design's own artboard height. */
export const MIN_HEIGHT = 230;

/** Height of one node box. */
export const NODE_HEIGHT = 26;

/** Vertical distance between two nodes in a column. */
export const ROW_PITCH = 44;

/** Column centres: the changed symbol, its callers, the endpoints. */
export const COLUMN_X = { root: 70, callers: 290, endpoints: 500 } as const;

/**
 * Where every caller's edge converges before the endpoint fan-out.
 *
 * Sits between the two columns because it is not a thing in the data: it is the
 * drawing's way of saying "downstream of all of these" without asserting which
 * caller reaches which route, which is a fact the server does not compute.
 */
export const JUNCTION_X = 395;

/** Roughly how many monospace characters fit in a node of a given width. */
export const CHARS_PER_PX = 1 / 7;
