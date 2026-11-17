import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import type { AssetLocation } from "@/lib/asset-location-service";
import { RemovePinButton, TourPinForm } from "@/components/asset/TourPinControls";

/**
 * Where a piece of equipment is: in the Matterport 3D tour, in 360 photos,
 * and on aerial imagery. Each row says plainly what exists for this store and
 * links into it, and says so when nothing does, rather than leaving a gap.
 */
export function AssetLocationCard({ assetId, location, canManage }: { assetId: string; location: AssetLocation; canManage: boolean }) {
  const p = location.propertyId;
  const { tour, panoramas, aerial } = location;
  return (
    <Card>
      <CardHeader title="Where it is" subtitle={location.area ? `${location.area}. Tour, 360 photos and aerial views of this store` : "Tour, 360 photos and aerial views of this store"} />
      <CardBody className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">3D tour (Matterport)</h3>
          {!tour.linked ? (
            <p className="text-sm text-muted">
              No 3D tour is linked to this store yet.{" "}
              {canManage ? (
                <Link href={`/properties/${p}?tab=interior`} className="text-brand hover:underline">
                  Link one on the Interior tab
                </Link>
              ) : null}
            </p>
          ) : (
            <>
              <p className="text-sm">
                <Link href={`/properties/${p}?tab=interior`} className="font-medium text-brand hover:underline">
                  Open the 3D tour{tour.spaceName ? `: ${tour.spaceName}` : ""}
                </Link>
              </p>
              {tour.pins.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {tour.pins.map((pin) => (
                    <li key={pin.id} className="flex items-center justify-between gap-2">
                      {pin.url ? (
                        <a href={pin.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          View this equipment in the tour{pin.label ? `: ${pin.label}` : ""}
                        </a>
                      ) : (
                        <span>Pinned{pin.label ? `: ${pin.label}` : ""}</span>
                      )}
                      {canManage ? <RemovePinButton assetId={assetId} pinId={pin.id} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Not pinned to a spot in the tour yet.</p>
              )}
              {canManage ? <TourPinForm assetId={assetId} /> : null}
            </>
          )}
        </section>

        <section className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">360 photos (Insta360 and others)</h3>
          {panoramas.ofThisAsset.length > 0 ? (
            <p className="text-sm">
              <Link href={`/properties/${p}?tab=360`} className="font-medium text-brand hover:underline">
                {panoramas.ofThisAsset.length} 360 photo{panoramas.ofThisAsset.length === 1 ? "" : "s"} of this equipment
              </Link>
              <span className="text-muted">
                {panoramas.ofThisAsset[0].capturedAt ? `, latest ${formatDate(panoramas.ofThisAsset[0].capturedAt)}` : ""}
              </span>
            </p>
          ) : panoramas.atStore > 0 ? (
            <p className="text-sm">
              <Link href={`/properties/${p}?tab=360`} className="font-medium text-brand hover:underline">
                Browse the {panoramas.atStore} 360 photo{panoramas.atStore === 1 ? "" : "s"} at this store
              </Link>
              <span className="text-muted">. None is tagged to this equipment.</span>
            </p>
          ) : (
            <p className="text-sm text-muted">No 360 photos at this store yet.</p>
          )}
        </section>

        <section className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Aerial (drone, DroneDeploy)</h3>
          {aerial.latest ? (
            <p className="text-sm">
              <Link href={`/properties/${p}?tab=exterior&capture=${aerial.latest.id}`} className="font-medium text-brand hover:underline">
                View the latest aerial imagery
              </Link>
              <span className="text-muted">
                {aerial.latest.capturedAt ? `, flown ${formatDate(aerial.latest.capturedAt)}` : ""}
                {aerial.latest.fromDroneDeploy ? ", from DroneDeploy" : ""}
                {aerial.markers > 0 ? `. ${aerial.markers} mark${aerial.markers === 1 ? "" : "s"} on this equipment.` : ""}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted">No aerial imagery at this store yet.</p>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
