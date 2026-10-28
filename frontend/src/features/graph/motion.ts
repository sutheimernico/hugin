/**
 * The graph's shared motion constants.
 *
 * One spring for every node that appears, so a card and the hub bloom with the same weight —
 * except that the hub is a fixed anchor beside the tree and must come to rest without a
 * wobble, so it gets the same stiffness at a damping ratio of ~1.
 */
export const BLOOM = { type: "spring", stiffness: 260, damping: 22 } as const;

/** Critically damped: `damping ≈ 2·√stiffness` is the point where the overshoot disappears. */
export const HUB_BLOOM = { type: "spring", stiffness: 260, damping: 32 } as const;

/** The house easing. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** How long one particle takes to travel its edge. */
export const PARTICLE_S = 0.8;
