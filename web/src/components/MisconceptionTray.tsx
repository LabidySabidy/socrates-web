/** MisconceptionTray — ONE row per id, always. */
import type { Misconception } from "../types.ts";
import { SEVERITY_COLOR, SEVERITY_LABEL } from "../severity.ts";
import { activeCount, trayRows } from "../misconceptions.ts";

function SeverityDot({ state }: { state: keyof typeof SEVERITY_COLOR }) {
  return (
    <span className="sev" style={{ color: SEVERITY_COLOR[state] }}>
      <span className="sev-dot" aria-hidden="true" />
      {SEVERITY_LABEL[state]}
    </span>
  );
}

export function MisconceptionTray({
  misconceptions,
  grillHref,
}: {
  misconceptions: Misconception[];
  /** Where a click on a row should go. Resolved by the page, which knows the units. */
  grillHref?: (concept: string) => string;
}) {
  const rows = trayRows(misconceptions);
  const active = activeCount(rows);

  return (
    <section className="tray" aria-label="Misconception tray">
      <h2>
        Misconception tray
        {rows.length > 0 ? ` · ${active} uncorrected` : ""}
      </h2>

      {rows.length === 0 ? (
        <p className="tray-empty">No misconceptions logged.</p>
      ) : (
        rows.map((row) => (
          <article className="tray-row" key={row.id}>
            <header className="tray-head">
              <span className="tray-id num">{row.id}</span>
              <span className="tray-concept">{row.concept}</span>
              <SeverityDot state={row.severity} />
            </header>
            {grillHref ? (
              <a
                className="tray-grill"
                href={grillHref(row.concept)}
                title={`grill this concept`}
              >
                Grill {row.concept}
              </a>
            ) : null}
            <p className="tray-body">{row.misconception}</p>
            {row.corrected ? <p className="tray-corrected">Corrected: {row.corrected}</p> : null}
          </article>
        ))
      )}
    </section>
  );
}
