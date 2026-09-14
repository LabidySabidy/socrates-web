/**
 * ReportsPage.tsx — reviewing after a session. This is the point of the feature.
 *
 * Newest first, both text fields in full, and a thumbnail that opens full size. Deleting removes BOTH files
 * server-side, so no orphan PNG is left behind — a store full of orphaned images would quietly become the
 * thing nobody trusts.
 *
 * It is reachable from the top bar (a "Reports" link beside the bug button) rather than only from inside the
 * panel: the panel is for CAPTURING, and burying the review screen behind it would mean opening a capture
 * dialog to read yesterday's notes.
 */
import { useCallback, useEffect, useState } from "react";
import { deleteReport, fetchReport, fetchReports, reportImageUrl, type ReportSummary } from "../api.ts";
import { formatDay } from "../select.ts";

export function ReportsPage() {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openImage, setOpenImage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, { role: string; text: string }[]>>({});

  const load = useCallback(() => {
    fetchReports()
      .then((d) => setReports(d.reports))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  async function remove(id: string) {
    setConfirming(null);
    const ok = await deleteReport(id);
    if (!ok) {
      setError("that report could not be deleted");
      return;
    }
    // Refetch rather than filtering locally, so the list is what the store actually holds.
    load();
    if (openImage === id) setOpenImage(null);
  }

  async function showTranscript(id: string) {
    const full = await fetchReport(id);
    setTranscripts((prev) => ({ ...prev, [id]: full.transcript ?? [] }));
  }

  if (error) {
    return (
      <main className="page">
        <h1 className="display greeting">Reports unavailable</h1>
        <p className="greeting-sub reading">{error}</p>
        <a href="#/home">← Back to the library</a>
      </main>
    );
  }
  if (!reports) {
    return (
      <main className="page">
        <p className="greeting-sub reading">Loading reports…</p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="display greeting">Bug reports</h1>
      <p className="greeting-sub reading">
        {reports.length === 0
          ? "Nothing reported yet. Use Report a bug in the top bar when something looks wrong."
          : `${reports.length} report${reports.length === 1 ? "" : "s"}, newest first.`}
      </p>

      <ul className="report-list">
        {reports.map((r) => (
          <li className="report-item" key={r.id}>
            <header>
              <span className="eyebrow">{formatDay(r.at)}</span>
              <span className="eyebrow">{r.route || "(no route)"}</span>
              {r.course ? (
                <span className="eyebrow">
                  {r.course}
                  {r.unit !== null ? ` · unit ${r.unit}` : ""}
                </span>
              ) : null}
              <span className="spacer" />
              {confirming === r.id ? (
                <>
                  <button type="button" onClick={() => void remove(r.id)}>
                    Delete for good
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(r.id)} aria-label={`Delete report ${r.id}`}>
                  Delete
                </button>
              )}
            </header>

            <p className="report-what reading">{r.whatIsWrong}</p>
            {r.expected ? <p className="report-expected reading">Expected: {r.expected}</p> : null}

            {r.hasImage ? (
              <button
                type="button"
                className="report-thumb-button"
                onClick={() => setOpenImage(openImage === r.id ? null : r.id)}
                aria-label={`${openImage === r.id ? "Hide" : "Show"} the screenshot for ${r.id}`}
              >
                <img className="report-thumb" src={reportImageUrl(r.id)} alt="" />
              </button>
            ) : (
              <p className="eyebrow">no screenshot</p>
            )}

            {openImage === r.id ? (
              <img className="report-full" src={reportImageUrl(r.id)} alt="The reported screen, full size" />
            ) : null}

            <div className="report-item-actions">
              <button type="button" onClick={() => void showTranscript(r.id)}>
                {transcripts[r.id] ? "Conversation" : "Show conversation"}
              </button>
            </div>
            {transcripts[r.id] ? (
              transcripts[r.id].length > 0 ? (
                <div className="report-transcript">
                  {transcripts[r.id].map((t, i) => (
                    <p key={i} className={t.role === "user" ? "msg-user" : "prose reading"}>
                      {t.text}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="eyebrow">no conversation attached</p>
              )
            ) : null}
          </li>
        ))}
      </ul>

      <p className="report-foot eyebrow">
        <a href="#/home">← Back to the library</a>
      </p>
    </main>
  );
}
