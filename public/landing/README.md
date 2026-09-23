# Landing page video

The scroll stage on `/` scrubs `prismpm-scroll.mp4` with the page's scroll position, showing `prismpm-scroll-poster.jpg` until it decodes.
If the clip is ever missing or unplayable the stage falls back to the stacked list with `ProductFrame`, so the page stays complete without it.

The current clip is one unbroken 20 second take: a floor plan seen from directly overhead, extruding into a wireframe tower as the camera tilts, then orbited while pulses of light run through its structure.
One shot rather than several cut together, so the descent never seams.

## Encoding for scrubbing

Scrubbing seeks constantly, and an accurate seek decodes forward from the preceding keyframe, so a replacement clip needs a short GOP or the scrub feels stepped:

```bash
ffmpeg -i source.mp4 -an -vf "delogo=x=1130:y=570:w=60:h=66" \
  -c:v libx264 -preset slow -crf 26 -g 4 -keyint_min 4 -sc_threshold 0 \
  -pix_fmt yuv420p -movflags +faststart public/landing/prismpm-scroll.mp4

ffmpeg -i public/landing/prismpm-scroll.mp4 -vframes 1 -q:v 3 \
  public/landing/prismpm-scroll-poster.jpg
```

`-g 4` caps a seek at three decoded frames and costs about 25% over a default GOP.

The `delogo` filter paints out the generator's watermark in the lower right by interpolating from its surroundings; drop it for footage that has none.
Thin bright lines on black compress well, so crf 26 holds up where a photographic clip would not: 20 seconds lands at 3.6 MB and is indistinguishable from the source at 2x zoom.

## Prism prologue

Before the descent, the same pinned stage scrubs `prismpm-prism.mp4`, a 10 second shot of a strategist raising a glass prism into a beam of light, showing `prismpm-prism-poster.jpg` until it decodes.
Three quotes on strategy and the view from above (`prologueBeats`) sit over the dark right of the frame, one per stretch of scroll.
From the 7 second mark the last quote clears, the camera pushes into the prism, and as it fills the screen the plan view slides in from the right.
The prism's position in the frame is `PRISM_FOCUS` in `src/widgets/landing/scroll-video.tsx`; re-measure it if the clip is replaced.
It is encoded like the descent, without audio and at crf 24 since it is photographic:

```bash
ffmpeg -i source.mp4 -an -c:v libx264 -preset slow -crf 24 -g 4 -keyint_min 4 -sc_threshold 0 \
  -pix_fmt yuv420p -movflags +faststart public/landing/prismpm-prism.mp4
```
