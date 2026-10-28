import { createCn } from "cn/config"

/**
 * The type scale and shadows from globals.css are custom theme tokens. Without registering them,
 * class merging reads `text-caption-1` as a text color and drops it next to `text-faded`.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["featured-1", "featured-2", "featured-3", "body-1", "body-2", "body-3", "caption-1", "caption-2"] }],
      shadow: [{ shadow: ["raised", "overlay", "lift"] }],
    },
  },
})

/** The guided tour's cards sit outside every dialog and sheet. Pressing one, like Do it for me, mustn't close the dialog it's explaining. */
export function keepOpenForTour<E extends Event>(handler?: (event: E) => void) {
  return (event: E) => {
    handler?.(event)
    // A card's button can be gone by the time the press counts as outside; nothing else outside a modal takes presses.
    if (event.target instanceof Element && (event.target.closest("[data-tour-layer]") || !event.target.isConnected)) event.preventDefault()
  }
}
