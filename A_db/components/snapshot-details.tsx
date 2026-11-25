import { formatDhaka } from "@/lib/utils";

const labels: Record<string, string> = {
  chassisVin: "Chassis / VIN",
  engineInfo: "Engine details",
  recipient: "Recipient name",
  addressLine: "Address",
  addressLine2: "Address line 2",
};

export function SnapshotDetails({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const fields =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).filter(
          ([key, item]) =>
            key !== "source" &&
            !key.endsWith("Id") &&
            item !== null &&
            item !== undefined &&
            item !== "" &&
            typeof item !== "object",
        )
      : [];
  return (
    <section className="mt-4 min-w-0">
      <h3 className="text-xs font-bold uppercase text-muted-foreground">
        {title}
      </h3>
      {fields.length ? (
        <dl className="mt-2 grid min-w-0 gap-4 rounded-xl bg-muted p-4 sm:grid-cols-2">
          {fields.map(([key, item]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {labels[key] ??
                  key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (letter) => letter.toUpperCase())}
              </dt>
              <dd className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">
                {key.endsWith("At") &&
                typeof item === "string" &&
                !Number.isNaN(Date.parse(item))
                  ? formatDhaka(item)
                  : typeof item === "boolean"
                    ? item
                      ? "Yes"
                      : "No"
                    : String(item).replaceAll("_", " ")}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Not supplied</p>
      )}
    </section>
  );
}
