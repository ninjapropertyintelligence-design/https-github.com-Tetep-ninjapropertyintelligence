import type { NormalizedBox } from "@/lib/ai/bounding-box";

export interface OverlayBox {
  id: string;
  box: NormalizedBox;
  label: string;
  severity: string | null;
  /** Pending boxes are drawn in their severity colour; confirmed ones in green. */
  state: "pending" | "confirmed";
}

const SEVERITY_BORDER: Record<string, string> = {
  LOW: "border-sky-500",
  MEDIUM: "border-amber-400",
  HIGH: "border-orange-500",
  CRITICAL: "border-red-600",
};
const SEVERITY_TAG: Record<string, string> = {
  LOW: "bg-sky-500",
  MEDIUM: "bg-amber-500",
  HIGH: "bg-orange-500",
  CRITICAL: "bg-red-600",
};

/**
 * A photo with AI finding boxes drawn over it.
 *
 * Why the boxes stay put: the overlay layer is exactly the image's own box,
 * and each rectangle is positioned in PERCENT of it, from coordinates stored
 * as fractions of the image. That only holds while the image is shown
 * uncropped at its true aspect ratio — `object-cover` would crop it and move
 * every box off its defect — so the image always fills the frame exactly.
 *
 * When the image's pixel size is known, the frame reserves that aspect ratio
 * before the photo loads, so nothing jumps when it arrives. When it is not,
 * the frame takes the image's natural height on load; boxes are still right.
 */
export function FindingImageOverlay({
  src,
  alt,
  imageWidth,
  imageHeight,
  boxes,
  className = "",
}: {
  src: string;
  alt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  boxes: OverlayBox[];
  className?: string;
}) {
  const aspect = imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0 ? `${imageWidth} / ${imageHeight}` : undefined;

  return (
    <figure className={`relative w-full overflow-hidden rounded-md border border-border bg-background ${className}`}>
      <div className="relative w-full" style={aspect ? { aspectRatio: aspect } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tenant-scoped bytes from our own route, not a static asset */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          // With a reserved aspect ratio the frame already has the image's
          // shape, so filling it is exact; without one, natural height.
          className={aspect ? "absolute inset-0 h-full w-full" : "block h-auto w-full"}
        />
        {boxes.map((b) => {
          const confirmed = b.state === "confirmed";
          const border = confirmed ? "border-green-500" : (SEVERITY_BORDER[b.severity ?? ""] ?? "border-red-600");
          const tag = confirmed ? "bg-green-600" : (SEVERITY_TAG[b.severity ?? ""] ?? "bg-red-600");
          // A box touching the top edge has no room for its tag above it, and
          // one in the right half anchors its tag to its right edge, so the
          // tag runs inward instead of being cut off by the frame.
          const tagInside = b.box.y < 0.08;
          const tagRight = b.box.x + b.box.w / 2 > 0.5;
          return (
            <div
              key={b.id}
              aria-hidden
              className={`pointer-events-none absolute border-2 ${border} ${confirmed ? "" : "shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"}`}
              style={{
                left: `${b.box.x * 100}%`,
                top: `${b.box.y * 100}%`,
                width: `${b.box.w * 100}%`,
                height: `${b.box.h * 100}%`,
              }}
            >
              <span
                className={`absolute ${tagRight ? "right-[-2px]" : "left-[-2px]"} max-w-[16rem] truncate whitespace-nowrap rounded-sm px-1 py-px text-[10px] font-semibold leading-tight text-white ${tag} ${
                  tagInside ? "top-0" : "-top-4"
                }`}
              >
                {confirmed ? "✓ " : ""}
                {b.label}
              </span>
            </div>
          );
        })}
      </div>
      {boxes.length > 0 ? (
        <figcaption className="sr-only">
          {boxes.map((b) => `${b.state === "confirmed" ? "Confirmed" : "AI suggested"}: ${b.label}`).join(". ")}
        </figcaption>
      ) : null}
    </figure>
  );
}
