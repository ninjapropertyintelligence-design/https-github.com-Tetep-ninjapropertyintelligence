import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CountdownBadge } from "@/components/expiry/CountdownBadge";
import { PhoneLink } from "@/components/contractor/CallLinks";
import { isoDay } from "@/lib/expiry-rules";
import type { ExpiryView } from "@/lib/expiry-service";

export interface TourPinRow {
  id: string;
  label: string | null;
  asset: { id: string; name: string };
  /** Opens the 3D tour at the equipment. */
  url: string | null;
}

/**
 * A store's expirations beside its 3D tour: what is running out, who to call,
 * and for equipment pinned in the tour, a link straight to where it stands.
 * Also lists what is pinned, so the tour reads as a map of the equipment.
 */
export function StoreExpirationsPanel({
  propertyId,
  expirations,
  pins,
  canReport,
}: {
  propertyId: string;
  expirations: ExpiryView[];
  pins: TourPinRow[];
  canReport: boolean;
}) {
  const pinByAsset = new Map<string, TourPinRow>();
  for (const pin of pins) if (!pinByAsset.has(pin.asset.id)) pinByAsset.set(pin.asset.id, pin);
  const expired = expirations.filter((e) => e.daysLeft < 0).length;
  const soon = expirations.filter((e) => e.daysLeft >= 0 && e.daysLeft <= 60).length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Expirations"
          subtitle={
            expirations.length === 0
              ? "Nothing is being counted down at this store yet"
              : `${expirations.length} tracked · ${expired} expired · ${soon} due within 60 days`
          }
          action={
            canReport ? (
              <a
                href={`/api/v1/reports/compliance?propertyId=${propertyId}&format=pdf`}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                Insurance record (PDF)
              </a>
            ) : null
          }
        />
        <CardBody className="p-0">
          {expirations.length === 0 ? (
            <p className="p-5 text-sm text-muted">
              Photograph a fire extinguisher tag or hood certificate on its equipment page and the date is read, remembered and counted down.
            </p>
          ) : (
            <ul>
              {expirations.slice(0, 30).map((e) => {
                const pin = e.asset ? pinByAsset.get(e.asset.id) : undefined;
                const vendor = e.asset?.serviceVendor;
                return (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                    <div className="space-y-0.5">
                      <p className="font-medium text-foreground">
                        {e.kind}
                        {e.label ? <span className="font-normal text-muted"> · {e.label}</span> : null}
                      </p>
                      <p className="text-xs text-muted">
                        {e.asset ? (
                          <Link href={`/assets/${e.asset.id}`} className="hover:text-brand">
                            {e.asset.name}
                          </Link>
                        ) : (
                          "Whole store"
                        )}
                        {" · expires "}
                        {isoDay(e.expiresAt)}
                      </p>
                      {e.needsReview ? <p className="text-xs text-amber-700">Read by AI from a photo. Check the date.</p> : null}
                      {pin?.url ? (
                        <p className="text-xs">
                          <a href={pin.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                            Show in the 3D tour
                          </a>
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1 text-right">
                      <CountdownBadge daysLeft={e.daysLeft} />
                      {vendor ? (
                        <p className="text-xs text-muted">
                          {vendor.name}
                          {vendor.contactPhone ? (
                            <>
                              {" · "}
                              <PhoneLink number={vendor.contactPhone} />
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {expirations.length > 0 ? (
            <p className="border-t border-border px-5 py-2.5 text-xs">
              <Link href={`/expirations?propertyId=${propertyId}`} className="text-brand hover:underline">
                Manage all expirations for this store
              </Link>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pinned in the tour" subtitle={pins.length === 0 ? "No equipment is pinned yet" : `${pins.length} pinned`} />
        <CardBody className="p-0">
          {pins.length === 0 ? (
            <p className="p-5 text-sm text-muted">Open a piece of equipment, stand at its spot in the tour, and paste the link to pin it.</p>
          ) : (
            <ul>
              {pins.slice(0, 30).map((pin) => (
                <li key={pin.id} className="flex items-center justify-between gap-2 border-b border-border px-5 py-2.5 text-sm last:border-0">
                  <Link href={`/assets/${pin.asset.id}`} className="text-foreground hover:text-brand">
                    {pin.asset.name}
                    {pin.label ? <span className="text-muted"> · {pin.label}</span> : null}
                  </Link>
                  {pin.url ? (
                    <a href={pin.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-brand hover:underline">
                      View
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
