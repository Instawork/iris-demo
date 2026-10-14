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
