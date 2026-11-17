/** A phone number as a tap-to-dial link; anything but digits and dialling punctuation is dropped from the href. */
export function PhoneLink({ number, label }: { number: string; label?: string }) {
  const href = `tel:${number.replace(/[^\d+]/g, "")}`;
  return (
    <a href={href} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
      {label ? <span className="font-normal text-muted">{label}</span> : null}
      {number}
    </a>
  );
}

export type CallableContractor = {
  name: string;
  trade: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  emergencyPhone: string | null;
};

/** How to reach a contractor: who to ask for, the phone, the after-hours phone, the email. */
export function ContractorContact({ c }: { c: CallableContractor }) {
  return (
    <div className="space-y-0.5 text-sm">
      {c.contactName ? <p className="text-muted">Ask for {c.contactName}</p> : null}
      {c.contactPhone ? <p><PhoneLink number={c.contactPhone} label="Call " /></p> : null}
      {c.emergencyPhone ? <p><PhoneLink number={c.emergencyPhone} label="After hours " /></p> : null}
      {c.contactEmail ? (
        <p>
          <a href={`mailto:${c.contactEmail}`} className="text-brand hover:underline">
            {c.contactEmail}
          </a>
        </p>
      ) : null}
      {!c.contactPhone && !c.emergencyPhone && !c.contactEmail ? <p className="text-muted">No contact details yet</p> : null}
    </div>
  );
}
